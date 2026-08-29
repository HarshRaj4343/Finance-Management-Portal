/**
 * The single definition of who is who.
 *
 * The prototype spelled roles four different ways ("pda-manager",
 * "pda manager", "bill_employee_fill", "Bill Employee") across the login
 * page, the sidebar, the database CHECK constraint and the demo login
 * list. Everything now normalises through here.
 *
 * Safe to import from client components: no secrets, no server imports.
 */

export const ROLES = [
  "User",
  "Bill Employee",
  "Bill Editor",
  "Student Purchase",
  "Audit",
  "Finance Admin",
  "PDA Manager",
  "Dean",
] as const;

export type Role = (typeof ROLES)[number];

/** Landing page for each role, straight after login. */
export const ROLE_HOME: Record<Role, string> = {
  "User": "/user",
  "Bill Employee": "/apply-bill",
  "Bill Editor": "/bill-editor",
  "Student Purchase": "/student-purchase",
  "Audit": "/audit",
  "Finance Admin": "/finance-admin",
  "PDA Manager": "/pda-manager",
  "Dean": "/admin",
};

/**
 * Old spellings that still exist in saved data, bookmarks and the demo
 * login list. Anything unrecognised falls back to "User", which can only
 * see its own bills.
 */
const ALIASES: Record<string, Role> = {
  "user": "User",
  "bill employee": "Bill Employee",
  "bill_employee_fill": "Bill Employee",
  "bill-form": "Bill Employee",
  "bill form": "Bill Employee",
  "bill editor": "Bill Editor",
  "bill_employee_edit": "Bill Editor",
  "bill-edit": "Bill Editor",
  "student purchase": "Student Purchase",
  "snp": "Student Purchase",
  "audit": "Audit",
  "finance admin": "Finance Admin",
  // "Finance Employee" was in the CHECK constraint and the login route map
  // but never had a page. Treat it as a plain user rather than a dead end.
  "finance employee": "User",
  "pda manager": "PDA Manager",
  "pda-manager": "PDA Manager",
  "pda_manager": "PDA Manager",
  "dean": "Dean",
};

export function normaliseRole(raw: string | null | undefined): Role {
  if (!raw) return "User";
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return ALIASES[key] ?? "User";
}

export function homeFor(raw: string | null | undefined): string {
  return ROLE_HOME[normaliseRole(raw)];
}

/** The approval desks, in the order a bill visits them. */
export const APPROVAL_STAGES = ["Student Purchase", "Audit", "Finance Admin"] as const;
export type Stage = (typeof APPROVAL_STAGES)[number];

export function isApprover(role: Role): role is Stage {
  return (APPROVAL_STAGES as readonly string[]).includes(role);
}

/** Roles allowed to see every bill in the portal, not just their own. */
export function canSeeAllBills(role: Role): boolean {
  return role !== "User";
}

/** The amount above which a bill must pass through Audit. */
export const AUDIT_THRESHOLD = 50000;

/**
 * Mirrors fn_route_after in 0002_functions.sql. Used only to *show* the
 * user where a bill is headed; the database decides what actually happens.
 * If these two ever disagree, the database is right.
 */
export function routeAfter(
  from: "Submit" | Stage,
  category: string,
  amount: number
): string {
  if (from === "Submit") {
    return category === "Consumables"
      ? amount <= AUDIT_THRESHOLD
        ? "Finance Admin"
        : "Audit"
      : "Student Purchase";
  }
  if (from === "Student Purchase") {
    return amount <= AUDIT_THRESHOLD ? "Finance Admin" : "Audit";
  }
  return "Finance Admin";
}

/** The desks a bill will visit, for the progress display on a bill page. */
export function plannedRoute(category: string, amount: number): string[] {
  const stops: string[] = [];
  let at: "Submit" | Stage = "Submit";
  for (let i = 0; i < 4; i++) {
    const next = routeAfter(at, category, amount);
    stops.push(next);
    if (next === "Finance Admin") break;
    at = next as Stage;
  }
  return stops;
}
