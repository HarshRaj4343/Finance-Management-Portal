import { NextRequest } from "next/server";
import { requireApprover } from "@/server/session";
import { fail, ok, badRequest } from "@/server/http";
import { decideBill } from "@/server/decide";
import { isUuid } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = ["Approved", "Rejected", "Hold", "Returned"] as const;
const DESKS = ["Student Purchase", "Audit", "Finance Admin"];
type Action = (typeof ACTIONS)[number];

/**
 * POST /api/bills/:id/action   { action, remark?, extra? }
 *
 * "Returned" sends the bill back to an earlier desk that approved it,
 * named in extra.return_to; its remark is optional (0010_send_back.sql).
 *
 * The only way a bill ever moves (with bulk-action, which uses the same
 * decideBill). fn_bill_action checks that the caller
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
      expected_revision?: number;
    };

    const action = body.action as Action;
    if (!ACTIONS.includes(action)) {
      return badRequest(`Unknown action. Expected one of: ${ACTIONS.join(", ")}.`);
    }
    if (action === "Returned" && !DESKS.includes(String(body.extra?.return_to ?? ""))) {
      return badRequest("Choose the desk to send this bill back to.");
    }
    if ((action === "Rejected" || action === "Hold") && !body.remark?.trim()) {
      return badRequest(
        `Please write a remark explaining why you are ${
          action === "Rejected" ? "rejecting" : "holding"
        } this bill.`
      );
    }

    if (!isUuid(id)) return badRequest("No such bill.");
    const extra = action === "Returned" ? { return_to: body.extra!.return_to } : body.extra ?? {};
    const bill = await decideBill(actor, id, action, body.remark ?? null, extra, body.expected_revision);
    return ok({ bill });
  } catch (err) {
    return fail(err, "Could not record that decision.");
  }
}
