import { Check, Pause, X } from "lucide-react";
import { plannedRoute } from "@/lib/roles";
import type { Bill } from "@/types/database";

type StepState = "done" | "current" | "hold" | "rejected" | "upcoming";

const KEY = { "Student Purchase": "snp", "Audit": "audit", "Finance Admin": "finance_admin" } as const;
const LABEL: Record<string, string> = { "Student Purchase": "Store & Purchase", "Audit": "Audit", "Finance Admin": "Finance Admin" };
const SR: Record<StepState, string> = { done: "done", current: "in progress", hold: "on hold", rejected: "rejected", upcoming: "not reached" };

function deskState(bill: Bill, desk: keyof typeof KEY): StepState {
  const state = bill[KEY[desk]];
  if (state === "Approved") return "done";
  if (state === "Reject") return "rejected";
  if (state === "Hold") return "hold";
  return bill.status === desk ? "current" : "upcoming";
}

const DOT: Record<StepState, string> = {
  done: "bg-green-600 text-white",
  current: "bg-white text-blue-700 ring-2 ring-blue-600",
  hold: "bg-amber-500 text-white",
  rejected: "bg-red-600 text-white",
  upcoming: "bg-white text-slate-400 ring-1 ring-slate-300",
};

/**
 * Where a bill is on its own route: Filed, each desk it must pass, then
 * final approval. Desks a bill never visits (e.g. Audit at ₹50,000 or less)
 * are not shown.
 */
export default function RouteTracker({ bill }: { bill: Bill }) {
  const desks = plannedRoute(bill.item_category, Number(bill.po_value)).filter((d): d is keyof typeof KEY => d in KEY);
  const steps: { label: string; state: StepState }[] = [
    { label: "Filed", state: "done" },
    ...desks.map((d) => ({ label: LABEL[d], state: deskState(bill, d) })),
    { label: "Approved", state: bill.status === "Accepted" ? "done" : "upcoming" },
  ];
  return (
    <ol aria-label="Approval progress" className="flex items-start">
      {steps.map((step, i) => (
        <li key={step.label} className="relative flex flex-1 flex-col items-center text-center">
          {i > 0 && (
            <span aria-hidden="true"
              className={`absolute right-1/2 top-2.5 h-0.5 w-full -translate-y-1/2 ${steps[i - 1].state === "done" ? "bg-green-600" : "bg-slate-200"}`} />
          )}
          <span className={`relative z-10 flex size-5 items-center justify-center rounded-full text-[10px] font-semibold ${DOT[step.state]}`} aria-hidden="true">
            {step.state === "done" ? <Check size={12} strokeWidth={3} />
              : step.state === "rejected" ? <X size={12} strokeWidth={3} />
              : step.state === "hold" ? <Pause size={11} strokeWidth={3} />
              : step.state === "current" ? <span className="size-2 rounded-full bg-blue-600" /> : null}
          </span>
          <span className={`mt-1.5 text-[11px] leading-tight ${step.state === "upcoming" ? "text-slate-500" : "font-medium text-slate-800"}`}>
            {step.label}
            <span className="sr-only">: {SR[step.state]}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
