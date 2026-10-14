"use client";

import React, { useEffect, useState } from "react";
import { api, money, dateOnly } from "@/lib/api";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "@/components/ui/page";
import QRCode from "react-qr-code";
import { billScopeQuery } from "@/lib/roles";
import { Bill } from "./types";

interface ApprovedBillsProps {
  department: string | null;
}

const ApprovedBills: React.FC<ApprovedBillsProps> = ({ department }) => {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!department) {
      setLoading(false);
      return;
    }

    const fetchApprovedBills = async () => {
      setLoading(true);
      const { data, error } = await api.bills<{ bills: Bill[] }>(
        `/api/bills?${billScopeQuery(department)}`
      );
      setLoading(false);

      if (error) {
        setError(error);
        setBills([]);
        return;
      }

      // Bills this department has had cleared at least one desk, and which
      // no desk has rejected or is holding.
      setError(null);
      setBills(
        data!.bills.filter((b) => {
          const desks = [b.snp, b.audit, b.finance_admin];
          return (
            desks.some((d) => d === "Approved") &&
            desks.every((d) => d === "Approved" || d == null)
          );
        })
      );
    };

    fetchApprovedBills();
  }, [department]);


  const handlePrintQR = (billId: string) => {
    const qrElement = document.getElementById(`qr-${billId}`);
    if (!qrElement) return;

    const qrContent = qrElement.outerHTML;
    const printWindow = window.open("", "_blank");
    printWindow?.document.write(`
      <html>
        <head>
          <title>Print QR Code</title>
          <style>
            body { display: flex; justify-content: center; align-items: center; height: 100vh; }
          </style>
        </head>
        <body>
          ${qrContent}
        </body>
      </html>
    `);
    printWindow?.document.close();
    printWindow?.print();
  };

  const header = <PageHeader title="Approved Bills" description="Bills that completed every approval. Print a QR sticker to label the purchased item." />;
  if (loading) return <div className="space-y-6">{header}<LoadingState label="Loading approved bills…" /></div>;
  if (bills.length === 0) return <div className="space-y-6">{header}<EmptyState title="No approved bills yet" /></div>;

  const th = "whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500";
  return (
    <div className="space-y-6">
      {header}
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className={th}>Bill</th>
              <th scope="col" className={`${th} text-right`}>Amount</th>
              <th scope="col" className={th}>Category</th>
              <th scope="col" className={th}>Desk decisions</th>
              <th scope="col" className={th}>Filed</th>
              <th scope="col" className={th}>QR sticker</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {bills.map((bill) => (
              <tr key={bill.id} className="align-top hover:bg-slate-50">
                <td className="px-4 py-3">
                  <a href={`/bill/${bill.id}`} className="whitespace-nowrap font-mono text-xs font-medium text-blue-700 hover:underline">{bill.bill_number ?? "—"}</a>
                  <p className="whitespace-nowrap font-medium text-slate-900">{bill.employee_name} <span className="text-xs font-normal text-slate-500">({bill.employee_id})</span></p>
                  <p className="max-w-xs truncate text-xs text-slate-500" title={bill.po_details ?? ""}>{bill.po_details ?? "—"}</p>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{bill.po_value != null ? money(bill.po_value) : "—"}</td>
                <td className="whitespace-nowrap px-4 py-3">{bill.item_category ?? "—"}</td>
                <td className="px-4 py-3">
                  <dl className="space-y-1 text-xs">
                    {([["Store and Purchase", bill.snp], ["Audit", bill.audit], ["Finance Admin", bill.finance_admin]] as const).map(([desk, state]) => (
                      <div key={desk} className="flex items-center gap-2">
                        <dt className="w-28 text-slate-500">{desk}</dt>
                        <dd><StatusBadge value={state} /></dd>
                      </div>
                    ))}
                  </dl>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{dateOnly(bill.created_at)}</td>
                <td className="px-4 py-3">
                  <div id={`qr-${bill.id}`} className="flex flex-col items-center gap-2">
                    <QRCode size={64} value={`${window.location.origin}/bill/${bill.id}`} title={`QR code for bill ${bill.bill_number ?? bill.id}`} />
                    <button onClick={() => handlePrintQR(bill.id)} className="text-xs font-medium text-blue-700 hover:underline">
                      Print QR
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ApprovedBills;
