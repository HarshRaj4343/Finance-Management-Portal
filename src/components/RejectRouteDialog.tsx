"use client";

import { useRef, useState } from "react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "./ui/alert-dialog";
import { money } from "@/lib/api";
import { deskLabel } from "@/lib/roles";
import { returnTargets } from "@/lib/bill-review";
import { cn } from "@/lib/utils";
import type { Bill } from "@/types/database";

/** Where a refused bill goes: an earlier desk (0010), the filer (Hold) or nowhere (Reject). */
export type RejectRoute =
  | { action: "Returned"; to: "Student Purchase" | "Audit" }
  | { action: "Hold" }
  | { action: "Rejected" };

type Choice = { key: string; route: RejectRoute; label: string; hint: string; needsRemark: boolean };

function choices(bill: Bill): Choice[] {
  const pool = !bill.funding_pool || bill.funding_pool === "PDA" ? "the applicant's PDA" : `the ${bill.funding_pool} budget`;
  return [
    ...returnTargets(bill).map((to): Choice => ({
      key: `desk:${to}`, route: { action: "Returned", to }, needsRemark: false,
      label: `Send back to ${deskLabel(to)}`,
      hint: `Its funds stay reserved. ${deskLabel(to)} can correct the bill and must approve it again; every desk after it reviews it afresh.`,
    })),
    { key: "filer", route: { action: "Hold" }, needsRemark: true, label: "Send back to the filer",
      hint: "Puts the bill on hold at your desk with its funds reserved, for the filer to correct." },
    { key: "reject", route: { action: "Rejected" }, needsRemark: true, label: "Reject permanently",
      hint: `Closes the bill and returns ${money(bill.po_value)} to ${pool}. The filer may still correct and resubmit it.` },
  ];
}

/**
 * Opens when a desk presses Reject: choose where the bill goes, with the
 * remark. This is the decision's confirmation step. Rejecting permanently
 * stays the default, so the R shortcut's Ctrl/⌘ + Enter twice behaves as
 * before. The database decides which desks are allowed; this only offers them.
 */
export default function RejectRouteDialog({ bill, initialRemark, busy, error, onCancel, onConfirm }: {
  bill: Bill;
  initialRemark: string;
  busy: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (route: RejectRoute, remark: string) => void;
}) {
  const options = choices(bill);
  const [picked, setPicked] = useState("reject");
  const [remark, setRemark] = useState(initialRemark);
  const [missing, setMissing] = useState(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const choice = options.find((o) => o.key === picked) ?? options[options.length - 1];
  const name = `reject-route-${bill.id}`;

  const confirm = () => {
    if (busy) return;
    if (choice.needsRemark && !remark.trim()) { setMissing(true); return; }
    onConfirm(choice.route, remark.trim());
  };

  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <AlertDialogContent onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
        onOpenAutoFocus={(e) => { e.preventDefault(); cancelButton.current?.focus(); }}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); confirm(); } }}>
        <AlertDialogTitle>Where should this bill go?</AlertDialogTitle>
        <AlertDialogDescription>
          {bill.bill_number ?? "This bill"} · {bill.employee_name} ({bill.employee_id}) · {money(bill.po_value)}, now at {deskLabel(bill.status)}.
        </AlertDialogDescription>
        <fieldset disabled={busy} className="space-y-2">
          <legend className="sr-only">Route for the refused bill</legend>
          {options.map((o) => (
            <label key={o.key} className={cn("flex cursor-pointer gap-3 rounded-lg border p-3 text-sm",
              picked === o.key ? (o.route.action === "Rejected" ? "border-red-400 bg-red-50" : "border-blue-400 bg-blue-50") : "border-slate-200 hover:bg-slate-50")}>
              <input type="radio" name={name} value={o.key} checked={picked === o.key} className="mt-1"
                onChange={() => { setPicked(o.key); setMissing(false); }} />
              <span>
                <span className="block font-medium text-slate-900">{o.label}</span>
                <span className="block text-slate-600">{o.hint}</span>
              </span>
            </label>
          ))}
          <label className="block pt-1 text-sm font-medium text-slate-700">
            Remark <span className="font-normal text-slate-500">({choice.needsRemark ? "required" : "optional"})</span>
            <textarea rows={2} value={remark} onChange={(e) => { setRemark(e.target.value); setMissing(false); }}
              placeholder={choice.route.action === "Returned" ? "What should be checked or corrected" : "Explain your decision"}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
          </label>
        </fieldset>
        {(missing || error) && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {missing ? `Write a remark to ${choice.route.action === "Hold" ? "send it back to the filer" : "reject it"}.` : error}
          </p>
        )}
        <AlertDialogFooter className="items-center">
          <span className="mr-auto hidden text-xs text-slate-500 sm:inline">Ctrl/⌘ + Enter to confirm · Esc to cancel</span>
          <AlertDialogCancel asChild>
            <button ref={cancelButton} type="button" disabled={busy} className="rounded-lg border px-4 py-2">Cancel</button>
          </AlertDialogCancel>
          <button type="button" disabled={busy} onClick={confirm}
            className={cn("rounded-lg px-4 py-2 text-white disabled:opacity-50",
              choice.route.action === "Rejected" ? "bg-red-600 hover:bg-red-700" : "bg-blue-700 hover:bg-blue-800")}>
            {busy ? "Recording…" : choice.route.action === "Rejected" ? "Reject bill" : choice.route.action === "Hold" ? "Send to filer" : "Send back"}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
