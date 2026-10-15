import { NextRequest } from "next/server";
import { query } from "@/server/db";
import { requireApprover } from "@/server/session";
import { fail, failText, ok, badRequest } from "@/server/http";
import { decideBill } from "@/server/decide";
import { isUuid } from "@/lib/utils";
import { money } from "@/lib/api";
import { BULK_LARGE_BILL, BULK_MAX_BILLS, BULK_MAX_TOTAL } from "@/lib/bulk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Outcome = { id: string; bill_number: string | null; ok: boolean; error?: string; bill?: unknown };

/**
 * POST /api/bills/bulk-action   { bills: [{ id, expected_revision }, ...] }
 *
 * Approves several bills at the caller's desk. Each bill is decided on its
 * own through decideBill -- the same transaction, checks, event log,
 * registers and email as a single approval -- so one refusal never touches
 * the others. The answer lists the outcome per bill.
 *
 * Approval only: holds and rejections need a remark per bill. At the Store
 * and Purchase desk the bills are approved without a bank guarantee.
 *
 * Limits (src/lib/bulk.ts), enforced here whatever the page sent: at most
 * BULK_MAX_BILLS bills and BULK_MAX_TOTAL in all, and no bill above
 * BULK_LARGE_BILL (such a bill is refused and must be approved on its own).
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireApprover();
    const body = (await req.json().catch(() => ({}))) as { bills?: unknown };
    if (!Array.isArray(body.bills) || body.bills.length === 0) return badRequest("Choose the bills to approve.");
    if (body.bills.length > BULK_MAX_BILLS) return badRequest(`Approve at most ${BULK_MAX_BILLS} bills at a time.`);
    const wanted = body.bills as { id?: unknown; expected_revision?: unknown }[];
    if (wanted.some((b) => typeof b?.id !== "string" || !isUuid(b.id) || !Number.isInteger(b.expected_revision))) {
      return badRequest("Each bill needs its id and the revision you reviewed.");
    }
    if (new Set(wanted.map((b) => b.id)).size !== wanted.length) return badRequest("A bill is listed twice.");

    // Amounts come from the database, never from the page.
    const rows = await query<{ id: string; bill_number: string | null; po_value: number }>(
      "select id, bill_number, po_value from public.bills where id = any($1::uuid[])", [wanted.map((b) => b.id)]
    );
    const found = new Map(rows.map((r) => [r.id, r]));
    const outcomes: Outcome[] = [];
    const eligible: { id: string; expected_revision: number }[] = [];
    for (const b of wanted as { id: string; expected_revision: number }[]) {
      const row = found.get(b.id);
      if (!row) outcomes.push({ id: b.id, bill_number: null, ok: false, error: "No such bill." });
      else if (Number(row.po_value) > BULK_LARGE_BILL) {
        outcomes.push({ id: b.id, bill_number: row.bill_number, ok: false, error: `Above ${money(BULK_LARGE_BILL)}: approve it on its own.` });
      } else eligible.push(b);
    }
    const total = eligible.reduce((sum, b) => sum + Number(found.get(b.id)!.po_value), 0);
    if (total > BULK_MAX_TOTAL) {
      return badRequest(`These bills come to ${money(total)}. Approve at most ${money(BULK_MAX_TOTAL)} at a time.`);
    }

    const extra = actor.role === "Student Purchase" ? { has_bank_guarantee: false } : {};
    // One at a time, in the order given: each is its own transaction.
    for (const b of eligible) {
      const number = found.get(b.id)!.bill_number;
      try {
        const bill = await decideBill(actor, b.id, "Approved", null, extra, b.expected_revision);
        outcomes.push({ id: b.id, bill_number: number, ok: true, bill });
      } catch (err) {
        outcomes.push({ id: b.id, bill_number: number, ok: false, error: failText(err, "Could not record the decision.") });
      }
    }
    const approved = outcomes.filter((o) => o.ok);
    return ok({
      approved: approved.length,
      failed: outcomes.length - approved.length,
      total: approved.reduce((sum, o) => sum + Number(found.get(o.id)!.po_value), 0),
      outcomes,
    });
  } catch (err) {
    return fail(err, "Could not record those decisions.");
  }
}
