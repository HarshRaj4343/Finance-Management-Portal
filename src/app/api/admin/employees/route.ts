import { NextRequest } from "next/server";
import { query, queryOne, Params, whereClause, likePattern } from "@/server/db";
import { requireRole } from "@/server/session";
import { fail, ok, badRequest } from "@/server/http";
import { ROLES, normaliseRole } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Dean of Finance's desk.
 *
 * architecture.jpeg: "Check Employee Type" / "No Employee Type Matched".
 * This is the only place a person's role is decided. Everything else in
 * the portal reads it.
 */

const EMAIL = /^[^@\s,]+@[^@\s,]+\.[a-zA-Z]{2,}$/;

/** GET /api/admin/employees — everyone, with their PDA position. */
export async function GET(req: NextRequest) {
  try {
    // Finance Admin keeps the directory it has always had; only the
    // Dean may decide what role anybody holds (see PATCH).
    await requireRole("Dean", "Finance Admin");
    const p = req.nextUrl.searchParams;

    const params = new Params();
    const where: string[] = [];

    if (p.get("role")) where.push(`e.employee_type = ${params.add(p.get("role"))}`);
    if (p.get("department")) where.push(`e.department::text = ${params.add(p.get("department"))}`);
    if (p.get("active") === "true") where.push("e.is_active");
    if (p.get("active") === "false") where.push("not e.is_active");

    const text = p.get("q")?.trim();
    if (text) {
      const like = params.add(likePattern(text));
      where.push(
        `(e.employee_code ilike ${like} or e.employee_name ilike ${like} or e.email ilike ${like})`
      );
    }

    // Each person's PDA position comes along in the same query.
    const employees = await query(
      `select e.*,
              case when pda.employee_id is null then null else json_build_object(
                'employee_id', pda.employee_id,
                'allocated',   pda.allocated,
                'balance',     pda.balance,
                'committed',   pda.committed,
                'spent',       pda.spent,
                'updated_at',  pda.updated_at
              ) end as pda
         from public.employees e
         left join public.pda_balances pda on pda.employee_id = e.employee_code
         ${whereClause(where)}
        order by e.employee_type, e.employee_code`,
      params.values
    );

    return ok({ employees, total: employees.length, roles: ROLES });
  } catch (err) {
    return fail(err, "Could not load the employee list.");
  }
}

/**
 * POST /api/admin/employees — add somebody who has not logged in yet.
 *
 * Useful for provisioning an auditor before their first sign-in, so they
 * do not land on the plain user page and wonder why.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole("Dean", "Finance Admin");
    const b = (await req.json()) as Record<string, string | number | boolean>;

    const code = String(b.employee_code ?? "").trim();
    const name = String(b.employee_name ?? "").trim();
    const email = String(b.email ?? "").trim().toLowerCase();
    const department = String(b.department ?? "").trim();
    // Adding a person is one thing; deciding they are an auditor is
    // another. Anyone but the Dean adds them as a plain user.
    const requested = normaliseRole(String(b.employee_type ?? "User"));
    const role = actor.role === "Dean" ? requested : "User";

    if (!code) return badRequest("An employee code is required.");
    if (!name) return badRequest("A name is required.");
    if (!EMAIL.test(email)) return badRequest(`"${email}" is not a valid email address.`);
    if (!department) return badRequest("Choose a department.");

    // Open a PDA account at the same time if an allocation was given. One
    // statement, so a failed PDA insert does not leave the person half-added.
    const allocated = Number(b.allocated ?? 0);
    const data = await queryOne(
      `with person as (
         insert into public.employees
           (employee_code, employee_name, email, department, employee_type, is_active)
         values ($1, $2, $3, $4, $5, true)
         returning *
       ), account as (
         insert into public.pda_balances (employee_id, email, department, allocated, balance)
         select employee_code, email, department, $6::numeric, $6::numeric
           from person where $6::numeric > 0
       )
       select * from person`,
      [code, name, email, department, role, allocated]
    );

    console.log(`[admin] ${actor.code} added ${code} as ${role}`);
    return ok(
      {
        employee: data,
        note:
          requested !== role
            ? `${name} was added as a plain user. Only the Dean of Finance can assign the ${requested} role.`
            : null,
      },
      201
    );
  } catch (err) {
    return fail(err, "Could not add that person.");
  }
}
