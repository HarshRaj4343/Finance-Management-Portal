"use client";

import { useRef, useState } from "react";
import { api, money } from "@/lib/api";
import { deskLabel } from "@/lib/roles";
import { canReviewDesk } from "@/lib/bill-review";
import type { Bill } from "@/types/database";
import { useConfirm } from "./ConfirmProvider";
import { billDecisionPrompt, type Decision } from "./confirmBillDecision";
import DecisionButtons from "./DecisionButtons";

type Desk = "Audit" | "Finance Admin";

function outcome(desk: Desk, action: Decision, bill: Bill): string {
  if (action === "Hold") return `The bill stays at ${desk} with its funds reserved, and the filer may correct it.`;
  if (action === "Rejected") return `The bill is rejected and ${money(bill.po_value)} goes back to the applicant's PDA. The filer may correct and resubmit it.`;
  return desk === "Finance Admin"
    ? `This is the final approval: ${money(bill.po_value)} will be debited from the applicant's PDA and entered in the purchase register.`
    : "The bill moves on to Finance Admin.";
}

function done(desk: Desk, action: Decision, bill: Bill, updated: Bill): string {
  if (action === "Hold") return "Bill put on hold. The decision is recorded on the bill timeline.";
  if (action === "Rejected") return `Bill rejected. ${money(bill.po_value)} has gone back to the applicant's PDA.`;
  return desk === "Finance Admin"
    ? `Bill ${updated.bill_number ?? ""} approved. ${money(bill.po_value)} has been debited and the purchase is now in the register.`
    : `Approved and sent to ${deskLabel(updated.status)}.`;
}

/**
 * Remark, Approve / Hold / Reject and the confirmation step for the Audit
 * and Finance Admin desks. Used on the desk queues and on Bill details, so
 * a decision looks and behaves the same wherever it is taken.
 */
export default function DeskReviewPanel({ bill, desk, actorCode, actorRole, onDecided }: {
  bill: Bill;
  desk: Desk;
  actorCode?: string | null;
  actorRole?: string | null;
  onDecided: (updated: Bill, message: string) => void | Promise<void>;
}) {
  const confirm = useConfirm();
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const sending = useRef(false);
  if (!canReviewDesk(bill, desk, actorCode, actorRole)) return null;
  const id = `remark-${bill.id}`;

  async function decide(action: Decision) {
    if (sending.current) return;
    setMessage(null);
    const text = remark.trim();
    if (action !== "Approved" && !text) {
      setMessage({ error: true, text: `Write a remark before you ${action === "Rejected" ? "reject" : "hold"} this bill.` });
      return;
    }
    if (!(await confirm(billDecisionPrompt(bill, action, text, outcome(desk, action, bill))))) return;
    sending.current = true; setBusy(true);
    const { data, error } = await api.post<{ bill: Bill }>(`/api/bills/${bill.id}/action`, {
      action, remark: text || undefined, expected_revision: bill.revision,
    });
    sending.current = false; setBusy(false);
    if (error || !data?.bill) { setMessage({ error: true, text: error ?? "Could not record the decision." }); return; }
    setRemark("");
    const note = done(desk, action, bill, data.bill);
    setMessage({ error: false, text: note });
    await onDecided({ ...bill, ...data.bill }, note);
  }

  return (
    <section aria-label={`${desk} decision`} className="space-y-3 print:hidden">
      {message && (
        <p role={message.error ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-sm ${message.error ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"}`}>
          {message.text}
        </p>
      )}
      <fieldset disabled={busy} className="space-y-3">
        <label htmlFor={id} className="block text-sm font-medium text-slate-700">
          {desk} remark <span className="font-normal text-slate-500">(required to hold or reject)</span>
        </label>
        <textarea
          id={id}
          data-remark
          rows={2}
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="Explain your decision"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        />
        <DecisionButtons onDecide={(action) => decide(action)} disabled={busy} busy={busy} />
      </fieldset>
    </section>
  );
}
