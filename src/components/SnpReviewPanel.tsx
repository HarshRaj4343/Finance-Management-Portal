"use client";

import { useRef, useState } from "react";
import DecisionButtons from "./DecisionButtons";
import RejectRouteDialog, { type RejectRoute } from "./RejectRouteDialog";
import SentBackNotice from "./SentBackNotice";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from "./ui/alert-dialog";
import { canReviewSnp, recordedBillDates } from "@/lib/bill-review";
import { api, money } from "@/lib/api";
import { deskLabel } from "@/lib/roles";
import { isMoney } from "@/lib/security";
import { shortDate } from "@/app/apply-bill/bill-form/model";
import type { Bill } from "@/types/database";

type Action = "Approved" | "Hold" | "Rejected";
const actionLabels: Record<Action, string> = { Approved: "Approve", Hold: "Hold", Rejected: "Reject" };
type Pending = { action: Action; revision: number; remark: string; extra: Record<string, unknown> };

/** Same review, confirmation, dates and server safeguards on dashboard and bill details. */
export default function SnpReviewPanel({ bill, actorCode, actorRole, onDecided }: {
  bill: Bill; actorCode?: string | null; actorRole?: string | null; onDecided: (bill: Bill) => void | Promise<void>;
}) {
  const [remark, setRemark] = useState("");
  const [hasGuarantee, setHasGuarantee] = useState(Boolean(bill.has_bank_guarantee));
  const [guaranteeDetails, setGuaranteeDetails] = useState(bill.bank_guarantee_details ?? "");
  const [guaranteeAmount, setGuaranteeAmount] = useState(bill.bank_guarantee_amount ? String(bill.bank_guarantee_amount) : "");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const sending = useRef(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const actionButton = useRef<HTMLButtonElement>(null);
  const allowed = canReviewSnp(bill, actorCode, actorRole);
  const dates = recordedBillDates(bill);

  function request(action: Action, button: HTMLButtonElement) {
    setMessage(null);
    if (!allowed || sending.current) return;
    if (action !== "Approved" && !remark.trim()) {
      setMessage({ error: true, text: "Write a remark explaining the hold or rejection first." }); return;
    }
    if (action === "Approved" && hasGuarantee && (!isMoney(Number(guaranteeAmount)) || Number(guaranteeAmount) <= 0 || !guaranteeDetails.trim())) {
      setMessage({ error: true, text: "A bank guarantee needs details and a positive amount with at most two decimal places." }); return;
    }
    actionButton.current = button;
    // Reject asks where the bill goes (RejectRouteDialog), which is its confirmation.
    if (action === "Rejected") { setRouteError(null); setRouting(true); return; }
    setPending({ action, revision: bill.revision, remark: remark.trim(), extra: {
      has_bank_guarantee: hasGuarantee,
      bank_guarantee_details: hasGuarantee ? guaranteeDetails.trim() : null,
      bank_guarantee_amount: hasGuarantee ? guaranteeAmount : null,
    } });
  }

  async function sendRoute(route: RejectRoute, text: string) {
    if (sending.current) return;
    sending.current = true; setBusy(true); setRouteError(null);
    try {
      const { data, error } = await api.post<{ bill: Bill }>(`/api/bills/${bill.id}/action`, {
        action: route.action, remark: text || undefined, expected_revision: bill.revision,
        ...(route.action === "Returned" ? { extra: { return_to: route.to } } : {}),
      });
      if (error || !data?.bill) { setRouteError(error ?? "Could not record the decision."); return; }
      setRouting(false);
      setMessage({ error: false, text: route.action === "Hold" ? "Bill put on hold; funds remain reserved."
        : route.action === "Rejected" ? "Bill rejected; reserved funds returned to the applicant's PDA." : `Sent back to ${deskLabel(route.to)}.` });
      setRemark(""); await onDecided(data.bill);
    } catch {
      setRouteError("Could not refresh the result. Reload before taking another action.");
    } finally { sending.current = false; setBusy(false); }
  }

  async function confirm() {
    if (!pending || sending.current) return;
    if (!allowed || pending.revision !== bill.revision) {
      setPending(null); setMessage({ error: true, text: "The bill has changed. Reload and review it again." }); return;
    }
    sending.current = true; setBusy(true);
    try {
      const { data, error } = await api.post<{ bill: Bill }>(`/api/bills/${bill.id}/action`, {
        action: pending.action, remark: pending.remark || undefined, expected_revision: pending.revision,
        ...(pending.action === "Approved" ? { extra: pending.extra } : {}),
      });
      if (error || !data?.bill) { setMessage({ error: true, text: error ?? "Could not record the decision." }); return; }
      setMessage({ error: false, text: pending.action === "Approved" ? `Approved and forwarded to ${deskLabel(data.bill.status)}.`
        : pending.action === "Hold" ? "Bill put on hold; funds remain reserved." : "Bill rejected; reserved funds returned to the applicant's PDA." });
      setRemark(""); await onDecided(data.bill);
    } catch {
      setMessage({ error: true, text: "Could not refresh the result. Reload before taking another action." });
    } finally { sending.current = false; setBusy(false); setPending(null); }
  }

  return <section aria-label="Store and Purchase review" className="space-y-4 print:hidden">
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm">
      <h3 className="mb-2 font-semibold">Dates recorded in the bill form</h3>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div><dt className="text-slate-600">Date of Delivery</dt><dd className="font-medium">{dates.delivery ? shortDate(dates.delivery) : "Not recorded in this legacy bill"}</dd></div>
        <div><dt className="text-slate-600">Date of Installation</dt><dd className="font-medium">{dates.installationNotRequired ? "Not required" : dates.installation ? shortDate(dates.installation) : "Not recorded in this legacy bill"}</dd></div>
      </dl>
      <p className="mt-2 text-xs text-slate-600">Read-only applicant facts. {dates.legacy ? "Legacy dates are extracted from the original saved bill text; no records were rewritten." : bill.form_data ? "Copied from the submitted bill form." : "This older bill has no verifiable recorded dates."}</p>
    </div>
    {allowed && <SentBackNotice bill={bill} canCorrect={!busy} onCorrected={onDecided} />}
    {message && <p role={message.error ? "alert" : "status"} className={`rounded-lg p-3 text-sm ${message.error ? "bg-red-50 text-red-700" : "bg-green-50 text-green-800"}`}>{message.text}</p>}
    {allowed && <fieldset disabled={busy || pending !== null} className="space-y-4 disabled:opacity-70">
      <div className="rounded-lg bg-purple-50 p-4">
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={hasGuarantee} onChange={(e) => setHasGuarantee(e.target.checked)} />Bank Guarantee Required</label>
        {hasGuarantee && <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Bank Guarantee Details<textarea className="mt-1 w-full rounded-lg border bg-white p-2" rows={2} value={guaranteeDetails} onChange={(e) => setGuaranteeDetails(e.target.value)} /></label>
          <label className="text-sm">Bank Guarantee Amount (₹)<input className="mt-1 w-full rounded-lg border bg-white p-2" type="number" min="0.01" step="0.01" value={guaranteeAmount} onChange={(e) => setGuaranteeAmount(e.target.value)} /></label>
        </div>}
      </div>
      <label className="block text-sm font-medium">Store and Purchase Department remark (required for Hold/Reject)
        <textarea data-remark className="mt-1 w-full rounded-lg border p-3" rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} />
      </label>
      <DecisionButtons onDecide={(action, button) => request(action, button)} disabled={busy || pending !== null || routing} busy={busy} />
    </fieldset>}
    {routing && <RejectRouteDialog bill={bill} initialRemark={remark.trim()} busy={busy} error={routeError}
      onCancel={() => { setRouting(false); if (actionButton.current?.isConnected) actionButton.current.focus(); }} onConfirm={sendRoute} />}
    <AlertDialog open={pending !== null} onOpenChange={(open) => { if (!open && !busy) setPending(null); }}>
      <AlertDialogContent onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); confirm(); } }}
        onOpenAutoFocus={(e) => { e.preventDefault(); cancelButton.current?.focus(); }}
        onCloseAutoFocus={(e) => { e.preventDefault(); if (actionButton.current?.isConnected) actionButton.current.focus(); }}>
        <AlertDialogTitle>Confirm {pending ? actionLabels[pending.action].toLowerCase() : "decision"}</AlertDialogTitle>
        <AlertDialogDescription>Review the bill and your decision before you continue.</AlertDialogDescription>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt>Bill</dt><dd>{bill.bill_number ?? bill.id}</dd><dt>Applicant</dt><dd>{bill.employee_name} ({bill.employee_id})</dd>
          <dt>Amount</dt><dd>{money(bill.po_value)}</dd><dt>Revision</dt><dd>{pending?.revision}</dd>
          <dt>Delivery</dt><dd>{dates.delivery ? shortDate(dates.delivery) : "Not recorded"}</dd><dt>Installation</dt><dd>{dates.installationNotRequired ? "Not required" : dates.installation ? shortDate(dates.installation) : "Not recorded"}</dd>
          <dt>Remark</dt><dd className="break-words whitespace-pre-wrap">{pending?.remark || "None"}</dd>
          {pending?.action === "Approved" && <><dt>Bank guarantee</dt><dd>{pending.extra.has_bank_guarantee ? `${money(Number(pending.extra.bank_guarantee_amount))} — ${pending.extra.bank_guarantee_details}` : "Not required"}</dd></>}
        </dl>
        <p className="text-sm">{pending?.action === "Approved" ? "This advances the bill to its next required desk." : pending?.action === "Hold" ? "This keeps the bill at this desk and its funds reserved." : "This rejection releases the bill's reserved funds. The filer may correct and resubmit it."}</p>
        <AlertDialogFooter className="items-center">
          <span className="mr-auto hidden text-xs text-slate-500 sm:inline">Ctrl/⌘ + Enter to confirm · Esc to cancel</span>
          <AlertDialogCancel asChild><button ref={cancelButton} type="button" disabled={busy} className="rounded-lg border px-4 py-2">Cancel</button></AlertDialogCancel>
          <button type="button" disabled={busy} onClick={confirm} className="rounded-lg bg-blue-700 px-4 py-2 text-white disabled:opacity-50">{busy ? "Recording…" : `Confirm ${pending ? actionLabels[pending.action] : "decision"}`}</button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
