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

// Retained for branch demonstrations away from the institute LDAP network.
// Demo login never supplies a role: active employee records remain authoritative.
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? (IS_PRODUCTION ? null : "123");
const DEMO_LOGIN_ENABLED =
  Boolean(DEMO_PASSWORD) &&
  (process.env.DEMO_LOGIN_ENABLED === "true" ||
    (!IS_PRODUCTION && process.env.DEMO_LOGIN_ENABLED !== "false"));
const DEMO_ACCOUNTS = [
  "Dean", "Finance Admin", "Audit", "SNP", "Bill-form",
  "pda manager", "User", "E001", "E002", "E003", "E004", "E005", "E006", "E007", "E008",
];

if (IS_PRODUCTION && DEMO_LOGIN_ENABLED) {
  console.warn(
    "[auth] WARNING: demo logins are ENABLED in production. Anyone who knows " +
    "DEMO_PASSWORD can sign in as Dean. Unset DEMO_LOGIN_ENABLED to disable them."
  );
}

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
  data = await queryOne(
      `select employee_code, employee_name, email, department, employee_type, is_active
         from public.employees where upper(employee_code) = upper($1)`,
      [code.trim()]
  );
  if (data && !data.is_active) throw new Error("This account is inactive.");
  if (!data) {
    // authorize() rejects unprovisioned accounts; this metadata does not
    // grant an API actor or an authenticated employee role.
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

        // Restrict DN input to institute identifier characters; no LDAP DN injection.
        if (!/^[a-zA-Z0-9._ -]{1,100}$/.test(username)) throw new Error("Invalid credentials");
        const isDemo = DEMO_LOGIN_ENABLED && DEMO_ACCOUNTS.includes(username);
        if (isDemo) {
          if (password !== DEMO_PASSWORD) throw new Error("Invalid credentials");
        } else {
          const identity = await authenticateWithLDAP(username, password);
          if (!identity) throw new Error("Invalid credentials");
        }
        const employee = await loadEmployee(username);
        if (!employee.provisioned) throw new Error("Your account has not been provisioned. Contact the Dean's office.");

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

  session: { strategy: "jwt", maxAge: 60 * 60 * 8 },
  jwt: { maxAge: 60 * 60 * 8 },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.signedInAt = Date.now();
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
      // eight hours for it to take effect. Re-read on every session access.
      if (token.employee_code) {
        if (typeof token.signedInAt !== "number" || Date.now() - token.signedInAt >= 8 * 60 * 60 * 1000) return {};
        let fresh;
        try { fresh = await loadEmployee(token.employee_code as string); } catch { return {}; }

        token.employee_type = fresh.role;
        token.name = fresh.name;
        token.email = fresh.email;
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
