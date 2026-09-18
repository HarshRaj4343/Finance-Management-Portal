import { NextRequest } from "next/server";
import { queryOne } from "@/server/db";
import { requireActor } from "@/server/session";
import { fail, ok, badRequest } from "@/server/http";
import { canSeeAllBills } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/lookup/employee?code=E001
 *
 * What the bill form needs when somebody types an employee ID: the name,
 * the department, and how much PDA is actually free.
 *
 * The prototype worked this out in the browser with four chained `like`
 * patterns against pda_balances, because employee codes in the data had
 * stray whitespace. The codes are now trimmed by a CHECK constraint, so
 * an exact match is enough.
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireActor();
    const code = req.nextUrl.searchParams.get("code")?.trim();
    if (!code) return badRequest("Give an employee code to look up.");

    // A plain user may only look themselves up.
    if (!canSeeAllBills(actor.role) && code !== actor.code) {
      return ok({ error: "You can only look up your own account." }, 403);
    }

    const employee = await queryOne(
      `select employee_code, employee_name, email, department, employee_type, is_active
         from public.employees where employee_code = $1`,
      [code]
    );

    if (!employee) {
      return ok(
        {
          found: false,
          message: `No employee is registered with the code "${code}".`,
        },
        200
      );
    }
    if (!employee.is_active) {
      return ok({
        found: false,
        message: `${employee.employee_name} (${code}) is no longer active.`,
      });
    }

    const pda = await queryOne(
      `select allocated, balance, committed, spent, updated_at
         from public.pda_balances where employee_id = $1`,
      [code]
    );

    return ok({
      found: true,
      employee,
      pda,
      message: pda
        ? null
        : `${employee.employee_name} has no PDA account yet. The PDA Manager needs to open one before a bill can be filed.`,
    });
  } catch (err) {
    return fail(err, "Could not look that employee up.");
  }
}
