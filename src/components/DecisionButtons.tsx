"use client";

import { Check, Pause, X } from "lucide-react";
import type { Decision } from "./confirmBillDecision";

/** The one Approve / Hold / Reject row every approval desk uses. */
export default function DecisionButtons({ onDecide, disabled = false, busy = false }: {
  onDecide: (action: Decision, button: HTMLButtonElement) => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const base = "inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={disabled} onClick={(e) => onDecide("Approved", e.currentTarget)}
        className={`${base} bg-green-600 text-white shadow-sm hover:bg-green-700`}>
        <Check size={16} aria-hidden="true" /> Approve
      </button>
      <button type="button" disabled={disabled} onClick={(e) => onDecide("Hold", e.currentTarget)}
        className={`${base} border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100`}>
        <Pause size={16} aria-hidden="true" /> Hold
      </button>
      <button type="button" disabled={disabled} onClick={(e) => onDecide("Rejected", e.currentTarget)}
        className={`${base} border border-red-300 bg-red-50 text-red-800 hover:bg-red-100`}>
        <X size={16} aria-hidden="true" /> Reject
      </button>
      {busy && <span className="text-sm text-slate-500" role="status">Recording…</span>}
    </div>
  );
}
