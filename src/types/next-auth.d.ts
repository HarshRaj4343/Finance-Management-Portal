import "next-auth";
import "next-auth/jwt";
import type { DefaultSession } from "next-auth";

/**
 * The shape of a session in this application.
 *
 * There used to be two files declaring this -- next-auth.d.ts and
 * session.ts -- with different shapes, which meant TypeScript could not
 * agree with itself about what session.user held.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      ou: string;
      employee_type?: string | null;
      employee_code?: string | null;
      department?: string | null;
      /** false when the person has authenticated but has no employees row */
      provisioned?: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    username: string;
    ou: string;
    employee_type?: string | null;
    employee_code?: string | null;
    department?: string | null;
    provisioned?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    username: string;
    ou: string;
    employee_type?: string | null;
    employee_code?: string | null;
    department?: string | null;
    provisioned?: boolean;
  }
}
