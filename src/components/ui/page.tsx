"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { deskLabel } from "@/lib/roles";

/** Title, one-line explanation and the page's primary actions. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export type Tone = "neutral" | "blue" | "green" | "amber" | "red" | "violet";

const TONE: Record<Tone, { value: string; ring: string; icon: string }> = {
  neutral: { value: "text-slate-900", ring: "border-slate-200", icon: "bg-slate-100 text-slate-600" },
  blue: { value: "text-blue-700", ring: "border-slate-200", icon: "bg-blue-50 text-blue-700" },
  green: { value: "text-green-700", ring: "border-slate-200", icon: "bg-green-50 text-green-700" },
  amber: { value: "text-amber-700", ring: "border-slate-200", icon: "bg-amber-50 text-amber-700" },
  red: { value: "text-red-700", ring: "border-slate-200", icon: "bg-red-50 text-red-700" },
  violet: { value: "text-violet-700", ring: "border-slate-200", icon: "bg-violet-50 text-violet-700" },
};

/** A headline number. With onClick it becomes a button that opens what it counts. */
export function StatCard({ label, value, hint, tone = "neutral", icon, onClick, active }: {
  label: string; value: ReactNode; hint?: string; tone?: Tone; icon?: ReactNode; onClick?: () => void; active?: boolean;
}) {
  const t = TONE[tone];
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        {icon && <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md [&>svg]:size-4", t.icon)}>{icon}</span>}
      </div>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", t.value)}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}{onClick && <span aria-hidden="true"> →</span>}</p>}
    </>
  );
  const cls = cn("rounded-xl border bg-white p-5 text-left shadow-sm", t.ring, active && "ring-2 ring-blue-500");
  if (!onClick) return <div className={cls}>{body}</div>;
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={cn(cls, "transition hover:border-slate-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500")}>
      {body}
    </button>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">{children}</div>;
}

const STATUS_TONE: Record<string, string> = {
  Pending: "bg-amber-50 text-amber-800 ring-amber-200",
  Hold: "bg-orange-50 text-orange-800 ring-orange-200",
  Approved: "bg-green-50 text-green-800 ring-green-200",
  Accepted: "bg-green-50 text-green-800 ring-green-200",
  Reject: "bg-red-50 text-red-800 ring-red-200",
  Rejected: "bg-red-50 text-red-800 ring-red-200",
};
const STATUS_TEXT: Record<string, string> = { Reject: "Rejected", Hold: "On hold", "Student Purchase": "Store & Purchase", "Store and Purchase Department": "Store & Purchase" };

/**
 * One look for every desk decision and bill status. Desk names such as
 * "Audit" render neutral blue: the bill is waiting there.
 */
export function StatusBadge({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return <span className="text-sm text-slate-500">—</span>;
  const tone = STATUS_TONE[value] ?? "bg-blue-50 text-blue-800 ring-blue-200";
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tone, className)}>
      {STATUS_TEXT[value] ?? deskLabel(value)}
    </span>
  );
}

/** A white panel with an optional titled header row. */
export function Panel({ title, actions, children, className, bodyClassName }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-slate-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
          {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
          {actions}
        </div>
      )}
      <div className={cn(bodyClassName ?? "p-5")}>{children}</div>
    </section>
  );
}

export function EmptyState({ title, description, icon }: { title: string; description?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      {icon && <span className="mb-3 text-slate-300 [&>svg]:size-12">{icon}</span>}
      <p className="font-medium text-slate-700">{title}</p>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-600" role="status">
      <span className="size-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" aria-hidden="true" />
      {label}
    </div>
  );
}

/**
 * Download as a spreadsheet, after a dialog asks which rows and columns to
 * include. The API applies the same permissions as the page.
 */
export { default as ExportButton, type ExportFilter, CATEGORY_OPTIONS, FUND_OPTIONS } from "../ExportDialog";
