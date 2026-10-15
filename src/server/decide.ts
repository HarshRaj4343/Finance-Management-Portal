import "server-only";
import { queryOne } from "./db";
import { notifyApplicant } from "./notify";
import type { Actor } from "./session";
import type { Stage } from "@/lib/roles";

export type DecisionAction = "Approved" | "Rejected" | "Hold";

/**
 * One desk decision on one bill: fn_bill_action checks the desk, the
 * revision, self-approval and the money in one transaction and writes the
 * event log; the applicant is then told of every hold, rejection and final
 * approval. Used by the single decision route and by bulk approval, so
 * both behave identically.
 */
export async function decideBill(
  actor: Actor & { role: Stage }, id: string, action: DecisionAction,
  remark: string | null, extra: Record<string, unknown>, expectedRevision: number | undefined
) {
  // Remember which desk it was at: fn_bill_action will have moved it on
  // by the time we come to write the notification.
  const before = await queryOne<{ status: string }>("select status from public.bills where id = $1", [id]);

  const row = await queryOne<{ bill: { status: string; bill_number: string | null } }>(
    "select public.fn_bill_action($1::uuid, $2, $3, $4, $5, $6, $7::jsonb) as bill",
    [id, actor.code, actor.name, actor.role, action, remark, JSON.stringify({ ...extra, expected_revision: expectedRevision })]
  );
  const bill = row?.bill;

  // Notify on every rejection and hold, and on the final approval.
  // Intermediate approvals are not worth an email; they are on the
  // timeline for anyone who wants to look.
  if (action !== "Approved" || bill?.status === "Accepted") {
    await notifyApplicant({
      billId: id,
      billNumber: bill?.bill_number ?? null,
      stage: before?.status ?? actor.role,
      outcome: action,
      remark: remark?.trim() || null,
      actorName: actor.name,
    });
  }
  return bill;
}
