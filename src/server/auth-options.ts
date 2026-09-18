import "server-only";
import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import ldap from "ldapjs";
import { queryOne } from "./db";
import { normaliseRole, type Role } from "@/lib/roles";

/**
 * Authentication.
 *
 * LDAP proves WHO you are. The employees table decides WHAT you may do.
 * The role is never taken from the login form, from LDAP, or from the
 * session the browser sends back -- it is read from the database on every
 * sign-in, and only the Dean's admin page can change it.
 */

const ldapConfig = {
  url: process.env.LDAP_URL ?? process.env.URL,
  baseDN: process.env.LDAP_BASE_DN ?? process.env.BaseDN,
  ou: process.env.OU
    ? (JSON.parse(process.env.OU) as string[])
    : ["students_ug", "Faculty", "Staff"],
};

/**
 * Fixed accounts for demonstrating the portal away from the institute
 * network, where no LDAP server is reachable. Every one of these exists as
 * a real row in `employees`, so the role still comes from the database.
 *
 * These bypass LDAP entirely, and the list includes "Dean", so leaving
 * them on in production hands anybody who guesses the password the run of
 * the portal. They are therefore OFF in production unless somebody turns
 * them on deliberately AND sets a password: no default, no "123".
 */
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? (IS_PRODUCTION ? null : "123");
const DEMO_LOGIN_ENABLED =
  DEMO_PASSWORD !== null &&
  (process.env.DEMO_LOGIN_ENABLED === "true" ||
    (!IS_PRODUCTION && process.env.DEMO_LOGIN_ENABLED !== "false"));

if (IS_PRODUCTION && DEMO_LOGIN_ENABLED) {
  console.warn(
    "[auth] WARNING: demo logins are ENABLED in production. Anyone who knows " +
      "DEMO_PASSWORD can sign in as Dean. Unset DEMO_LOGIN_ENABLED to disable them."
  );
}
const DEMO_ACCOUNTS = [
  "Dean",
  "Finance Admin",
  "Audit",
  "SNP",
  "Bill-form",
  "Bill-edit",
  "pda manager",
  "User",
  "E001", "E002", "E003", "E004", "E005", "E006", "E007", "E008",
];

type LdapIdentity = { uid: string; cn: string; mail: string; ou: string };

async function authenticateWithLDAP(
  username: string,
  password: string
): Promise<LdapIdentity | null> {
  if (!ldapConfig.url || !ldapConfig.baseDN) {
    console.error("[ldap] LDAP_URL / LDAP_BASE_DN are not configured");
    return null;
  }

  for (const ou of ldapConfig.ou) {
    const dn = `uid=${username},ou=${ou},${ldapConfig.baseDN}`;

    const bound = await new Promise<boolean>((resolve) => {
      const client = ldap.createClient({
        url: ldapConfig.url as string,
        timeout: 5000,
        connectTimeout: 5000,
      });

      let settled = false;
      const done = (result: boolean) => {
        if (settled) return;
        settled = true;
        try {
          client.unbind();
        } catch {
          /* the socket may already be gone */
        }
        resolve(result);
      };

      const timer = setTimeout(() => done(false), 6000);

      client.on("error", () => done(false));
      client.bind(dn, password, (err: unknown) => {
        clearTimeout(timer);
        done(!err);
      });
    });

    if (bound) {
      return {
        uid: username,
        cn: username,
        mail: `${username}@iitmandi.ac.in`,
        ou,
      };
    }
  }
  return null;
}

/** The employees table is the only source of a person's role. */
async function loadEmployee(code: string): Promise<{
  code: string;
  name: string;
  email: string | null;
  department: string | null;
  role: Role;
  provisioned: boolean;
}> {
  let data: {
    employee_code: string;
    employee_name: string | null;
    email: string | null;
    department: string | null;
    employee_type: string;
    is_active: boolean;
  } | null = null;
  let error: { code?: string; message: string } | null = null;

  try {
    data = await queryOne(
      `select employee_code, employee_name, email, department, employee_type, is_active
         from public.employees where employee_code = $1`,
      [code.trim()]
    );
  } catch (err) {
    error = err as { code?: string; message: string };
  }

  if (error) {
    // A missing column or table here means the migrations have not been
    // applied to this project. Without this line the only symptom is that
    // everybody silently signs in as a plain User, which looks like a
    // permissions bug rather than a deployment one.
    if (error.code === "42703" || error.code === "42P01") {
      console.error(
        `[auth] SCHEMA MISMATCH -- ${error.message}. ` +
          "Apply db/migrations/0001_schema.sql and 0002_functions.sql " +
          "to this database (npm run db:setup). Until then every sign-in falls back to the User role."
      );
    } else {
      console.error("[auth] employee lookup failed", error.message);
    }
  }

  if (!data || data.is_active === false) {
    // Authenticated, but nobody has given them a role yet. They get the
    // plain user view, which only shows their own bills, and the UI tells
    // them to contact the Dean's office.
    return {
      code: code.trim(),
      name: code.trim(),
      email: null,
      department: null,
      role: "User",
      provisioned: false,
    };
  }

  return {
    code: data.employee_code,
    name: data.employee_name ?? data.employee_code,
    email: data.email ?? null,
    department: data.department ?? null,
    role: normaliseRole(data.employee_type),
    provisioned: true,
  };
}

export const authOptions: AuthOptions = {
  providers: [
    CredentialsProvider({
      name: "IIT Mandi LDAP",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },

      async authorize(credentials) {
        const username = credentials?.username?.trim();
        const password = credentials?.password;
        if (!username || !password) {
          throw new Error("Enter both a username and a password.");
        }

        const isDemo =
          DEMO_LOGIN_ENABLED && DEMO_ACCOUNTS.includes(username);

        if (isDemo) {
          if (password !== DEMO_PASSWORD) {
            throw new Error("Invalid credentials");
          }
        } else {
          const identity = await authenticateWithLDAP(username, password);
          if (!identity) {
            throw new Error("Invalid credentials");
          }
        }

        const employee = await loadEmployee(username);

        return {
          id: employee.code,
          username: employee.code,
          name: employee.name,
          email: employee.email ?? `${employee.code}@iitmandi.ac.in`,
          ou: isDemo ? "demo" : "ldap",
          employee_type: employee.role,
          employee_code: employee.code,
          department: employee.department,
          provisioned: employee.provisioned,
        };
      },
    }),
  ],

  session: { strategy: "jwt" },
  jwt: { maxAge: 60 * 60 * 8 },

  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        const u = user as unknown as Record<string, unknown>;
        token.id = u.id as string;
        token.username = u.username as string;
        token.ou = u.ou as string;
        token.employee_type = u.employee_type as string;
        token.employee_code = u.employee_code as string;
        token.department = u.department as string | null;
        token.provisioned = u.provisioned as boolean;
      }

      // If the Dean changes someone's role, they should not have to wait
      // eight hours for it to take effect. Re-read on an explicit update.
      if (trigger === "update" && token.employee_code) {
        const fresh = await loadEmployee(token.employee_code as string);
        token.employee_type = fresh.role;
        token.department = fresh.department;
        token.provisioned = fresh.provisioned;
      }

      return token;
    },

    async session({ session, token }) {
      session.user = {
        ...session.user,
        id: token.id as string,
        username: token.username as string,
        ou: token.ou as string,
        employee_type: token.employee_type as string,
        employee_code: token.employee_code as string,
        department: (token.department as string) ?? null,
        provisioned: (token.provisioned as boolean) ?? false,
      };
      return session;
    },
  },

  pages: { signIn: "/login" },
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
} as AuthOptions;
