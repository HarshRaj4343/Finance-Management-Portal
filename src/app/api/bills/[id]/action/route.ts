import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { requireApprover } from "@/server/session";
import { fail, ok, badRequest } from "@/server/http";
import { notifyApplicant } from "@/server/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = ["Approved", "Rejected", "Hold"] as const;
type Action = (typeof ACTIONS)[number];

/**
 * POST /api/bills/:id/action   { action, remark?, extra? }
 *
 * The only way a bill ever moves. fn_bill_action checks that the caller
 * actually owns the desk the bill is sitting at, refuses to touch a bill
 * that has already been decided, moves the money, and writes the event
 * log -- all in one transaction.
 *
 * The role is taken from the session, never from the request body, so a
 * user cannot approve their own bill by posting {"role":"Finance Admin"}.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireApprover();
    const { id } = await params;
    const body = (await req.json()) as {
      action?: string;
      remark?: string;
      extra?: Record<string, unknown>;
    };

    const action = body.action as Action;
    if (!ACTIONS.includes(action)) {
      return badRequest(`Unknown action. Expected one of: ${ACTIONS.join(", ")}.`);
    }
    if (action !== "Approved" && !body.remark?.trim()) {
      return badRequest(
        `Please write a remark explaining why you are ${
          action === "Rejected" ? "rejecting" : "holding"
        } this bill.`
      );
    }

    // Remember which desk it was at: fn_bill_action will have moved it on
    // by the time we come to write the notification.
    const { data: before } = await db()
      .from("bills")
      .select("status")
      .eq("id", id)
      .maybeSingle();

    const { data: bill, error } = await db().rpc("fn_bill_action", {
      p_bill_id: id,
      p_actor_code: actor.code,
      p_actor_name: actor.name,
      p_actor_role: actor.role,
      p_action: action,
      p_remark: body.remark ?? null,
      p_extra: body.extra ?? {},
    });
    if (error) throw error;

    const stage = before?.status ?? actor.role;
    const finished = bill?.status === "Accepted";

    // Notify on every rejection and hold, and on the final approval.
    // Intermediate approvals are not worth an email; they are on the
    // timeline for anyone who wants to look.
    if (action !== "Approved" || finished) {
      await notifyApplicant({
        billId: id,
        billNumber: bill?.bill_number ?? null,
        stage,
        outcome: action,
        remark: body.remark?.trim() || null,
        actorName: actor.name,
      });
    }

    return ok({ bill });
  } catch (err) {
    return fail(err, "Could not record that decision.");
  }
}
