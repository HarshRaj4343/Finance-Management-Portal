import { NextRequest } from "next/server";
import { query, queryOne } from "@/server/db";
import { requireActor } from "@/server/session";
import { fail, ok, badRequest } from "@/server/http";
import { canSeeAllBills } from "@/lib/roles";
import { isUuid } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/bills/:id/note — acknowledge a rejected bill.
 *
 * "Noting" a bill clears it from the filing desk's list. It moves no
 * money.
 *
 * It used to: the old handler added the bill's value back to the PDA by
 * hand, because a rejection left the money debited. fn_bill_action now
 * releases the reservation at the moment of rejection, so doing it here as
 * well would credit the same amount twice.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireActor();
    const { id } = await params;

    const bill = isUuid(id)
      ? await queryOne(
          "select id, bill_number, status, employee_id, noted from public.bills where id = $1",
          [id]
        )
      : null;
    if (!bill) return badRequest("No such bill.");

    if (!canSeeAllBills(actor.role) && bill.employee_id !== actor.code) {
      return badRequest("That bill belongs to somebody else.");
    }
    if (bill.status !== "Rejected") {
      return badRequest(
        `Only a rejected bill can be noted. This one is ${
          bill.status === "Accepted" ? "already approved" : `still with ${bill.status}`
        }.`
      );
    }
    if (bill.noted) return ok({ bill, alreadyNoted: true });

    const updated = await queryOne(
      "update public.bills set noted = true where id = $1 returning *",
      [id]
    );

    await query("select public.fn_log_event($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10)", [
      id,
      "Applicant",
      "Forwarded",
      actor.code,
      actor.name,
      actor.role,
      "Rejection acknowledged by the filing desk.",
      "Rejected",
      "Rejected",
      null,
    ]);

    return ok({ bill: updated });
  } catch (err) {
    return fail(err, "Could not note that bill.");
  }
}
