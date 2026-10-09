"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { api, money, when } from "@/lib/api";
import { billScopeQuery, isUmbrellaDepartment, deskLabel } from "@/lib/roles";
import { Bill } from "./types";

/**
 * Bills this department has filed that are still moving: sitting at a desk
 * or on hold. Accepted and rejected bills have their own tabs.
 */
const isPending = (b: Bill) => b.status !== "Accepted" && b.status !== "Rejected";

const PendingBills: React.FC<{ department: string | null; refreshKey?: number }> = ({ department, refreshKey }) => {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!department) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      const { data, error } = await api.get<{ bills: Bill[] }>(
        `/api/bills?${billScopeQuery(department)}`
      );
      setLoading(false);
      setError(error);
      setBills(data ? data.bills.filter(isPending) : []);
    })();
  }, [department, refreshKey]);

  const heldAt = (b: Bill) =>
    [b.snp, b.audit, b.finance_admin].some((d) => d === "Hold") ? "On hold" : "In progress";

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
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Loading…</td></tr>
            )}
            {!loading && bills.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No bills are pending.</td></tr>
            )}
            {bills.map((b) => (
              <tr key={b.id}>
                <td className="px-4 py-3">
                  <Link href={`/bill/${b.id}`} className="font-mono font-medium text-blue-700 hover:underline">
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
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">{deskLabel(b.status)}</span>
                  <p className="mt-1 text-xs text-slate-500">{heldAt(b)}</p>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{when(b.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PendingBills;
