import React, { type ReactNode } from 'react';
import Link from "next/link";
import { when } from "@/lib/api";
import { Bill } from '@/types/database';
import BillItems from './BillItems';
import { StatusBadge } from "./ui/page";

interface BillCardProps {
  bill: Bill;
  showBankGuarantee?: boolean;
  className?: string;
  /** A desk's decision controls, shown in the card's footer. */
  children?: ReactNode;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-900">{children || "—"}</dd>
    </div>
  );
}

export const BillCard: React.FC<BillCardProps> = ({
  bill,
  showBankGuarantee = true,
  className = '',
  children,
}) => {
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
  };

  const formatCurrency = (amount: number | null) => {
    if (amount === null || amount === undefined) return 'N/A';
    return `₹${amount.toLocaleString()}`;
  };


 // The A4 bill sheet, sent straight to the printer.
  const handlePrintBill = () => window.open(`/bill/${bill.id}/print?print=1`, "_blank", "noopener");

  const remarks = [
    ["Store and Purchase Department", bill.remarks1],
    ["Audit", bill.remarks2],
    ["Finance Admin", bill.remarks],
    ["Other", bill.remarks3],
    ["Additional", bill.remarks4],
  ].filter(([, text]) => text) as [string, string][];

  return (
    <article className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <div className="space-y-4 p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-slate-500">{bill.bill_number ?? "Unnumbered bill"}</span>
              <StatusBadge value={bill.status} />
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{bill.item_category}</span>
            </div>
            <h3 className="mt-1 text-base font-semibold text-slate-900">{bill.item_description || "No description"}</h3>
            <p className="text-sm text-slate-600">{bill.supplier_name || "Supplier not recorded"}</p>
          </div>
          <div className="text-right">
            <p className="text-xl font-semibold tabular-nums text-slate-900">{formatCurrency(bill.po_value)}</p>
            <p className="text-xs text-slate-500">{bill.employee_name} ({bill.employee_id})</p>
          </div>
        </header>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
          <Field label="PO">{bill.po_details}</Field>
          <Field label="Quantity">{bill.qty ?? 0}</Field>
          <Field label="Location">{bill.location}</Field>
          <Field label="Department">{bill.employee_department}</Field>
          <Field label="Filed">{when(bill.created_at)}</Field>
        </dl>

        <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg bg-slate-50 px-4 py-3 text-sm">
          {([["Store and Purchase", bill.snp], ["Audit", bill.audit], ["Finance Admin", bill.finance_admin]] as const).map(([desk, state]) => (
            <span key={desk} className="flex items-center gap-2">
              <span className="text-slate-600">{desk}</span>
              {state ? <StatusBadge value={state} /> : <span className="text-xs text-slate-400" title="Not on this bill's route, or not reached yet">—</span>}
            </span>
          ))}
        </div>

        {bill.form_data && (
          <details className="group rounded-lg border border-slate-200">
            <summary className="cursor-pointer select-none px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Item and price breakdown ({bill.form_data.lines.length} {bill.form_data.lines.length === 1 ? "item" : "items"})
            </summary>
            <div className="border-t border-slate-200 px-4"><BillItems bill={bill} /></div>
          </details>
        )}

        {showBankGuarantee && (
          <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm">
            <p className="font-medium text-violet-900">Bank guarantee</p>
            {bill.has_bank_guarantee ? (
              <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Details">{bill.bank_guarantee_details}</Field>
                <Field label="Amount">{formatCurrency(bill.bank_guarantee_amount)}</Field>
                <Field label="Delivery">{bill.date_of_delivery ? formatDate(bill.date_of_delivery) : null}</Field>
                <Field label="Installation">{bill.date_of_installation ? formatDate(bill.date_of_installation) : null}</Field>
              </dl>
            ) : (
              <p className="mt-1 text-violet-800">Not required for this bill.</p>
            )}
          </div>
        )}

        {remarks.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Remarks</p>
            {remarks.map(([desk, text]) => (
              <p key={desk} className="rounded-lg border-l-4 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <span className="font-medium text-slate-900">{desk}:</span> {text}
              </p>
            ))}
          </div>
        )}
      </div>

      {children && <div className="border-t border-slate-200 p-5">{children}</div>}

      <footer className="flex flex-wrap gap-2 border-t border-slate-200 px-5 py-3">
        <Link href={`/bill/${bill.id}`} className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
          View details
        </Link>
        <button type="button" onClick={handlePrintBill}
          className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Print bill
        </button>
      </footer>
    </article>
  );
};

export default BillCard;
