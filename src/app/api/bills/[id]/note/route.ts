import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { requireActor } from "@/server/session";
import { fail, ok, badRequest } from "@/server/http";
import { canSeeAllBills } from "@/lib/roles";

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

    const { data: bill, error } = await db()
      .from("bills")
      .select("id, bill_number, status, employee_id, noted")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
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

    const { data: updated, error: updErr } = await db()
      .from("bills")
      .update({ noted: true })
      .eq("id", id)
      .select()
      .single();
    if (updErr) throw updErr;

    await db().rpc("fn_log_event", {
      p_bill_id: id,
      p_stage: "Applicant",
      p_action: "Forwarded",
      p_actor_code: actor.code,
      p_actor_name: actor.name,
      p_actor_role: actor.role,
      p_remark: "Rejection acknowledged by the filing desk.",
      p_from_status: "Rejected",
      p_to_status: "Rejected",
      p_amount: null,
    });

    return ok({ bill: updated });
  } catch (err) {
    return fail(err, "Could not note that bill.");
  }
}
