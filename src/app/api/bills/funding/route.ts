import { NextRequest } from "next/server";
import { requireActor } from "@/server/session";
import { findEmployee } from "@/server/employee";
import { assertBillWriter } from "@/server/bill-validation";
import { isApprover } from "@/lib/roles";
import { queryOne } from "@/server/db";
import { ok, fail, badRequest } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only funding snapshot, restricted to the applicant, their authorised
 * filer/editor, and a desk holding one of the applicant's bills that was
 * sent back to it for correction (0010_send_back.sql).
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireActor();
    const code = req.nextUrl.searchParams.get("employee")?.trim();
    if (!code) return badRequest("Choose an applicant.");
    const employee = await findEmployee(code);
    if (!employee?.is_active) return badRequest("Choose an active applicant.");
    const correcting = isApprover(actor.role) && await queryOne(
      "select 1 from public.bills where employee_id = $1 and status = $2 and returned_from is not null limit 1",
      [employee.employee_code, actor.role]);
    if (!correcting) assertBillWriter(actor, employee.employee_code, employee.department, true);
    const account = await queryOne(
      "select employee_id, allocated, balance, committed, spent, is_active from public.pda_balances where employee_id=$1",
      [employee.employee_code]
    );
    return ok({ account });
  } catch (error) { return fail(error, "Could not load the applicant's PDA."); }
}
