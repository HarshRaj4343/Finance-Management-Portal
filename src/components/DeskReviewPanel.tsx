"use client";

import { useRef, useState } from "react";
import { api, money } from "@/lib/api";
import { deskLabel } from "@/lib/roles";
import { canReviewDesk, returnTargets } from "@/lib/bill-review";
import type { Bill } from "@/types/database";
import { useConfirm } from "./ConfirmProvider";
import { billDecisionPrompt, type Decision } from "./confirmBillDecision";
import DecisionButtons from "./DecisionButtons";
import RejectRouteDialog, { type RejectRoute } from "./RejectRouteDialog";
import SentBackNotice from "./SentBackNotice";

type Desk = "Audit" | "Finance Admin";

function outcome(desk: Desk, action: Decision, bill: Bill): string {
  if (action === "Hold") return `The bill stays at ${desk} with its funds reserved, and the filer may correct it.`;
  if (action === "Rejected") return `The bill is rejected and ${money(bill.po_value)} goes back to the applicant's PDA. The filer may correct and resubmit it.`;
  return desk === "Finance Admin"
    ? `This is the final approval: ${money(bill.po_value)} will be debited from the applicant's PDA and entered in the purchase register.`
    : "The bill moves on to Finance Admin.";
}

function routed(desk: Desk, route: RejectRoute, bill: Bill, updated: Bill): string {
  return route.action === "Returned"
    ? `Sent back to ${deskLabel(route.to)}. Its funds remain reserved.`
    : done(desk, route.action, bill, updated);
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
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const sending = useRef(false);
  if (!canReviewDesk(bill, desk, actorCode, actorRole)) return null;
  const id = `remark-${bill.id}`;

  // Reject asks where the bill goes: an earlier desk, the filer, or nowhere.
  async function sendRoute(route: RejectRoute, text: string) {
    if (sending.current) return;
    sending.current = true; setBusy(true); setRouteError(null);
    const { data, error } = await api.post<{ bill: Bill }>(`/api/bills/${bill.id}/action`, {
      action: route.action, remark: text || undefined, expected_revision: bill.revision,
      ...(route.action === "Returned" ? { extra: { return_to: route.to } } : {}),
    });
    sending.current = false; setBusy(false);
    if (error || !data?.bill) { setRouteError(error ?? "Could not record the decision."); return; }
    setRouting(false); setRemark("");
    const note = routed(desk, route, bill, data.bill);
    setMessage({ error: false, text: note });
    await onDecided({ ...bill, ...data.bill }, note);
  }

  async function decide(action: Decision) {
    if (sending.current) return;
    setMessage(null);
    const text = remark.trim();
    // With nowhere to send it back to, the remark is required before the popup, as before.
    if (action === "Rejected" && (text || returnTargets(bill).length > 0)) { setRouteError(null); setRouting(true); return; }
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
      <SentBackNotice bill={bill} canCorrect={!busy}
        onCorrected={(updated) => onDecided(updated, `${updated.bill_number ?? "Bill"} corrected. It is still at ${desk}; approve it to send it on.`)} />
      {message && (
        <p role={message.error ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-sm ${message.error ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"}`}>
          {message.text}
        </p>
      )}
      <fieldset disabled={busy} className="space-y-3">
        <label htmlFor={id} className="block text-sm font-medium text-slate-700">
          {desk} remark <span className="font-normal text-slate-500">(required to hold or reject; optional to send back to a desk)</span>
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
        <DecisionButtons onDecide={(action) => decide(action)} disabled={busy || routing} busy={busy} />
      </fieldset>
      {routing && (
        <RejectRouteDialog bill={bill} initialRemark={remark} busy={busy} error={routeError}
          onCancel={() => setRouting(false)} onConfirm={sendRoute} />
      )}
    </section>
  );
}
