import { NextRequest } from "next/server";
import { queryOne } from "@/server/db";
import { requireActor } from "@/server/session";
import { fail, ok, badRequest } from "@/server/http";
import { canSeeAllBills } from "@/lib/roles";
import { findEmployee } from "@/server/employee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/lookup/employee?code=E001
 *
 * IDs match without regard to case. `profile=only` serves the bill form's
 * identity fields; the full response serves account management pages.
 *
 * The prototype worked this out in the browser with four chained `like`
 * patterns against pda_balances, because employee codes in the data had
 * stray whitespace. The codes are now trimmed by a CHECK constraint, so
 * the canonical employee code can safely be used for foreign keys.
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireActor();
    const code = req.nextUrl.searchParams.get("code")?.trim();
    if (!code) return badRequest("Give an employee code to look up.");

    // A plain user may only look themselves up.
    if (!canSeeAllBills(actor.role) && code.toUpperCase() !== actor.code.toUpperCase()) {
      return ok({ error: "You can only look up your own account." }, 403);
    }

    const employee = await findEmployee(code);

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

    // Bill formation only needs identity. Keep financial information on
    // the user and management pages, without even querying it here.
    if (req.nextUrl.searchParams.get("profile") === "only") {
      return ok({ found: true, employee, message: null });
    }

    const pda = await queryOne(
      `select allocated, balance, committed, spent, updated_at
         from public.pda_balances where employee_id = $1`,
      [employee.employee_code]
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
