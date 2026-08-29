import "server-only";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth-options";
import { normaliseRole, isApprover, type Role, type Stage } from "@/lib/roles";

/** Who is making this request, as far as the server is concerned. */
export type Actor = {
  code: string;
  name: string;
  email: string | null;
  role: Role;
  department: string | null;
  provisioned: boolean;
};

export async function currentActor(): Promise<Actor | null> {
  const session = await getServerSession(authOptions);
  const u = session?.user as Record<string, unknown> | undefined;
  if (!u?.employee_code) return null;

  return {
    code: String(u.employee_code),
    name: String(u.name ?? u.employee_code),
    email: (u.email as string) ?? null,
    // Normalise again here: a JWT minted before a role was renamed could
    // still be carrying the old spelling.
    role: normaliseRole(u.employee_type as string),
    department: (u.department as string) ?? null,
    provisioned: Boolean(u.provisioned),
  };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Any signed-in person. */
export async function requireActor(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw new HttpError(401, "Please sign in.");
  return actor;
}

/** A signed-in person holding one of the given roles. */
export async function requireRole(...allowed: Role[]): Promise<Actor> {
  const actor = await requireActor();
  if (!allowed.includes(actor.role)) {
    throw new HttpError(
      403,
      `This needs ${allowed.join(" or ")} access. You are signed in as ${actor.role}.`
    );
  }
  return actor;
}

/** Somebody who sits at one of the three approval desks. */
export async function requireApprover(): Promise<Actor & { role: Stage }> {
  const actor = await requireActor();
  if (!isApprover(actor.role)) {
    throw new HttpError(403, "Only an approving desk can act on a bill.");
  }
  return actor as Actor & { role: Stage };
}
