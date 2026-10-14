"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { api, money, when } from "@/lib/api";
import { billScopeQuery, isUmbrellaDepartment } from "@/lib/roles";
import { Bill } from "./types";
import EditBillModal from "./EditBillModal";
import { StatusBadge } from "@/components/ui/page";
import { canCorrectBill, deskRemark, editWindowLeft, heldAtCurrentDesk } from "@/lib/bill-review";

const countdown = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Bills this department has filed that are still moving: sitting at a desk
 * or on hold. Accepted and rejected bills have their own tabs.
 *
 * A bill can be corrected here during its edit window straight after
 * filing, and again once a desk puts it on hold.
 */
const isPending = (b: Bill) => b.status !== "Accepted" && b.status !== "Rejected";

const PendingBills: React.FC<{ department: string | null; refreshKey?: number }> = ({ department, refreshKey }) => {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Bill | null>(null);
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!department) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      const { data, error } = await api.bills<{ bills: Bill[] }>(
        `/api/bills?${billScopeQuery(department)}`
      );
      setLoading(false);
      setError(error);
      setBills(data ? data.bills.filter(isPending) : []);
    })();
  }, [department, refreshKey, reload]);

  // Tick only while some bill is still inside its edit window.
  const ticking = bills.some((b) => editWindowLeft(b, now) > 0);
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);

  const heldAt = (b: Bill) => {
    const left = editWindowLeft(b, now);
    if (left > 0) return `Editable for ${countdown(left)}, then sent to the desk`;
    return heldAtCurrentDesk(b) ? "On hold" : "In progress";
  };

  return (
    <div className="mx-auto w-full max-w-6xl">
      <h1 className="mb-1 text-2xl font-semibold text-slate-900">Pending Bills</h1>
      <p className="mb-5 text-sm text-slate-500">
        {isUmbrellaDepartment(department) ? "Bills filed through Store and Purchase for any school" : `Bills filed for ${department ?? "your department"}`} that are still waiting on a desk.
      </p>
      {error && <p className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Bill</th>
              <th className="px-4 py-3 font-medium">Supplier / Item</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">With</th>
              <th className="px-4 py-3 font-medium">Filed</th>
              <th className="px-4 py-3 font-medium">Correct</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading…</td></tr>
            )}
            {!loading && bills.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No bills are pending.</td></tr>
            )}
            {bills.map((b) => (
              <tr key={b.id}>
                <td className="px-4 py-3">
                  <Link href={`/bill/${b.id}`} className="whitespace-nowrap font-mono font-medium text-blue-700 hover:underline">
                    {b.bill_number ?? "—"}
                  </Link>
                  <p className="text-xs text-slate-500">{b.employee_name} ({b.employee_id})</p>
                </td>
                <td className="max-w-xs px-4 py-3">
                  <p className="truncate font-medium text-slate-900">{b.supplier_name ?? "—"}</p>
                  <p className="truncate text-xs text-slate-500">{b.item_description ?? "—"}</p>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{money(b.po_value)}</td>
                <td className="px-4 py-3">
                  <StatusBadge value={b.status} />
                  <p className="mt-1 text-xs text-slate-500">{heldAt(b)}</p>
                  {heldAtCurrentDesk(b) && deskRemark(b) && (
                    <p className="mt-1 max-w-xs text-xs text-amber-900">Remark: {deskRemark(b)}</p>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{when(b.created_at)}</td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setEditing(b)}
                    disabled={!canCorrectBill(b, now)}
                    title={canCorrectBill(b, now) ? "Correct this bill" : "Editable only within the first minutes after filing, or after a desk holds or rejects it"}
                    className="rounded-md bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <EditBillModal bill={editing} onClose={() => setEditing(null)} onBillUpdated={() => setReload((n) => n + 1)} />
      )}
    </div>
  );
};

export default PendingBills;
