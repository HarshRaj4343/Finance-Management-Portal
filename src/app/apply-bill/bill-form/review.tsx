"use client";

import React, { useState } from "react";
import { ChevronUp, Pencil } from "lucide-react";
import { AUDIT_THRESHOLD, routeAfter, deskLabel } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { Banner, Button, Card } from "./ui";
import { FUNDS } from "./masters";
import { FormState, inr, lineQty, lineTotal, placeLabel, shortDate, toNum, totals } from "./model";
import type { Lookup, StepProps } from "./steps-basic";

// ---------------------------------------------------------------------
// Step 6 — Review
// ---------------------------------------------------------------------

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-slate-500">{k}</dt>
          <dd className="mt-0.5 break-words text-sm text-slate-900">{v || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

const EditBtn = ({ onClick, what }: { onClick: () => void; what: string }) => (
  <Button variant="outline" className="h-8 px-3 text-xs" onClick={onClick} aria-label={`Edit ${what}`}>
    <Pencil className="size-3.5" aria-hidden="true" /> Edit
  </Button>
);

export function StepReview({
  f,
  set,
  errors,
  goTo,
  lookup,
}: StepProps & {
  goTo: (step: number) => void;
  lookup: Lookup;
}) {
  const T = totals(f);
  const fund = FUNDS.find((x) => x.code === f.fund);

  return (
    <div className="space-y-8">
      <Banner tone="info">Check everything below. Nothing is filed until you submit at the bottom of this page.</Banner>

      <Card title="Submitter" action={<EditBtn what="submitter" onClick={() => goTo(0)} />}>
        <Rows
          rows={[
            ["Employee ID / Student Enrolment", f.requesterCode.trim()],
            ["Name", lookup.name ?? f.requesterName],
            ["Department / Section", lookup.department ?? ""],
          ]}
        />
      </Card>

      <Card title="Purchase Order and Supplier" action={<EditBtn what="purchase order and supplier" onClick={() => goTo(1)} />}>
        <Rows
          rows={[
            ["Purchase type", f.purchaseType === "po" ? "Against PO" : "Direct Purchase (No PO)"],
            ...(f.purchaseType === "po"
              ? ([
                  ["PO number", f.poNumber],
                  ["PO date", shortDate(f.poDate)],
                ] as [string, string][])
              : []),
            ["PO / purchase value", inr(toNum(f.poValue))],
            ["Supplier", f.supplierName],
            ["Address", <span key="a" className="whitespace-pre-line">{f.supplierAddress}</span>],
          ]}
        />
      </Card>

      <Card title="Bill" action={<EditBtn what="bill details" onClick={() => goTo(2)} />}>
        <Rows
          rows={[
            ["Bill number", f.billNo],
            ["Bill date", shortDate(f.billDate)],
            ["Bill amount", inr(T.basic)],
            ["Other charges", inr(T.other)],
            ["Total bill amount", <strong key="t">{inr(T.total)}</strong>],
            ["Delivered", f.deliveryDate ? shortDate(f.deliveryDate) : "—"],
            ["Installation", f.installRequired === "yes" ? `Done on ${shortDate(f.installDate)}` : "Not required"],
            ["Remarks", f.remarks],
          ]}
        />
      </Card>

      <Card title="Items" action={<EditBtn what="items" onClick={() => goTo(3)} />}>
        <p className="mb-3 text-xs text-slate-500">Category: {f.category}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="py-2 pr-3 font-medium">Item</th>
                <th className="py-2 pr-3 text-right font-medium">Qty</th>
                <th className="py-2 pr-3 text-right font-medium">Unit price</th>
                <th className="py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {f.lines.map((l, i) => (
                <tr key={l.key} className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-3">
                    <p className="font-medium text-slate-900">{l.type}</p>
                    <p className="text-xs text-slate-500">{l.description}</p>
                    <p className="sr-only">Item {i + 1}</p>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{lineQty(l)} {l.uom}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{inr(l.unitPrice)}</td>
                  <td className="py-2 text-right tabular-nums">{inr(lineTotal(l))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Funding and Stock" action={<EditBtn what="funding and stock" onClick={() => goTo(4)} />}>
        <Rows
          rows={[
            ["Source of fund", fund ? `${fund.code} — ${fund.description}` : f.fund],
            ["Units / issued", `${T.units} / ${T.issued}`],
            ["Stock Entry No.", "Generated by the system on submission"],
            ...f.lines.flatMap((l, i) => [
              [`Item ${i + 1}: custodian`, l.custodian],
              [`Item ${i + 1}: placed at`, placeLabel(l)],
            ] as [string, string][]),
          ]}
        />
      </Card>

      <Card title="Declaration">
        <div className="space-y-4">
          <Check
            id="f-total-confirmed"
            checked={f.totalConfirmed}
            onChange={(v) => set({ totalConfirmed: v })}
            error={errors["f-total-confirmed"]}
          >
            The total of <strong>{inr(T.total)}</strong> matches the total on the supplier&apos;s bill.
          </Check>
          <Check
            id="f-declaration"
            checked={f.declaration}
            onChange={(v) => set({ declaration: v })}
            error={errors["f-declaration"]}
          >
            I confirm that the bill details are correct.
          </Check>
          {errors["f-total"] && <Banner tone="error">{errors["f-total"]}</Banner>}
        </div>
      </Card>
    </div>
  );
}

function Check({
  id,
  checked,
  onChange,
  error,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-sm text-slate-800">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          className="mt-0.5 size-4 shrink-0 rounded border-slate-400 accent-blue-700"
        />
        <span>{children}</span>
      </label>
      {error && (
        <p id={`${id}-err`} className="mt-1.5 pl-7 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Live summary: side panel on desktop, collapsible bar on mobile
// ---------------------------------------------------------------------

export function SummaryPanel({
  f,
  variant,
}: {
  f: FormState;
  variant: "side" | "bar";
}) {
  const [open, setOpen] = useState(false);
  const T = totals(f);
  const fund = FUNDS.find((x) => x.code === f.fund);
  const hasTotal = T.total > 0;
  const route = hasTotal ? routeAfter("Submit", f.category, T.total) : null;

  const rows: { k: string; v: string }[] = [
    { k: "PO value", v: toNum(f.poValue) > 0 ? inr(toNum(f.poValue)) : "—" },
    { k: "Bill total", v: hasTotal ? inr(T.total) : "—" },
    { k: "Units", v: T.units ? String(T.units) : "—" },
    { k: "Fund", v: fund ? fund.code : "—" },
  ];

  const body = (
    <>
      <dl className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.k} className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-slate-600">{r.k}</dt>
            <dd className="font-medium tabular-nums text-slate-900">
              {r.v}
            </dd>
          </div>
        ))}
      </dl>
      {route && (
        <p className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-600">
          First stop: <strong className="text-slate-900">{deskLabel(route)}</strong>
          {T.total > AUDIT_THRESHOLD ? " (above ₹ 50,000, so Audit will see it)" : ""}.
        </p>
      )}
    </>
  );

  if (variant === "side") {
    return (
      <aside aria-label="Bill summary" className="sticky top-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Summary</h2>
        {body}
      </aside>
    );
  }

  return (
    <div className="border-t border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm"
      >
        <span className="font-medium text-slate-900">Summary</span>
        <span className="flex items-center gap-2 tabular-nums text-slate-700">
          {hasTotal ? inr(T.total) : "—"}
          <ChevronUp className={cn("size-4 transition-transform", !open && "rotate-180")} aria-hidden="true" />
        </span>
      </button>
      {open && <div className="px-4 pb-4">{body}</div>}
    </div>
  );
}
