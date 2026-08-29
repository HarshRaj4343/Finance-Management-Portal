"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { api, money, qs, when } from "@/lib/api";
import { normaliseRole } from "@/lib/roles";
import type { RegisterEntry, DepartmentRow } from "@/types/database";

/**
 * The departmental purchase register.
 *
 * The register a finance office actually keeps: one line per purchase that
 * completed the approval workflow, under a running serial number, so that
 * "where is this logged" has an answer. Entries are cut automatically at
 * the moment of final approval and can never be edited or deleted -- the
 * database refuses both.
 *
 * There is no way to add a line by hand, and that is the point.
 */

type Totals = {
  entries: number;
  amount: number;
  departments: number;
  financial_year: string;
};

export default function RegisterPage() {
  const { data: session, status } = useSession();

  const [entries, setEntries] = useState<RegisterEntry[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [total, setTotal] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [fy, setFy] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const role = normaliseRole((session?.user as { employee_type?: string })?.employee_type);
  const scoped = role === "User";

  useEffect(() => {
    api
      .get<{ departments: DepartmentRow[] }>("/api/departments")
      .then(({ data }) => data && setDepartments(data.departments));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await api.get<{
      entries: RegisterEntry[];
      total: number;
      totals: Totals;
    }>(
      "/api/register" +
        qs({ q: search, department, fy, limit: pageSize, offset: page * pageSize })
    );
    setLoading(false);

    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setEntries(data!.entries);
    setTotal(data!.total);
    setTotals(data!.totals);
  }, [search, department, fy, page]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [status, load]);

  // Financial years present in the data, newest first.
  const years = useMemo(() => {
    const set = new Set(entries.map((e) => e.financial_year));
    if (totals?.financial_year) set.add(totals.financial_year);
    return [...set].sort().reverse();
  }, [entries, totals]);

  const pages = Math.ceil(total / pageSize);

  if (status === "loading") {
    return <div className="mt-20 text-center text-gray-500">Loading…</div>;
  }
  if (status === "unauthenticated") {
    if (typeof window !== "undefined") window.location.href = "/login";
    return null;
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* ------------------------------------------------------ header */}
      <header className="bg-[#217093] px-6 py-5 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.08em] opacity-80">
              IIT Mandi · Integrated Finance Management Portal
            </p>
            <h1 className="mt-1 text-2xl font-semibold">Purchase Register</h1>
          </div>
          <Link
            href="/"
            className="rounded border border-white/40 px-4 py-2 text-sm hover:bg-white/10"
          >
            Back to portal
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        <p className="mb-5 max-w-3xl text-sm leading-relaxed text-gray-600">
          Every purchase that completed the approval workflow, in the order it
          was entered. Serial numbers are issued per department per financial
          year at the moment of final approval.{" "}
          <strong className="font-medium text-gray-800">
            Entries cannot be edited or removed.
          </strong>
          {scoped && " You are seeing your own purchases."}
        </p>

        {/* ---------------------------------------------------- summary */}
        {totals && (
          <div className="mb-5 grid gap-4 sm:grid-cols-3">
            {[
              ["Entries", totals.entries.toLocaleString("en-IN")],
              ["Total value", money(totals.amount)],
              ["Departments", String(totals.departments)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border bg-white p-4 shadow-sm">
                <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* ---------------------------------------------------- filters */}
        <div className="mb-4 flex flex-wrap gap-3">
          <input
            value={search}
            onChange={(e) => {
              setPage(0);
              setSearch(e.target.value);
            }}
            placeholder="Serial number, item, supplier, employee…"
            className="min-w-[16rem] flex-1 rounded-lg border px-3 py-2 text-sm focus:border-[#217093] focus:outline-none"
          />
          <select
            value={department}
            onChange={(e) => {
              setPage(0);
              setDepartment(e.target.value);
            }}
            className="rounded-lg border px-3 py-2 text-sm focus:border-[#217093] focus:outline-none"
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>
          <select
            value={fy}
            onChange={(e) => {
              setPage(0);
              setFy(e.target.value);
            }}
            className="rounded-lg border px-3 py-2 text-sm focus:border-[#217093] focus:outline-none"
          >
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* ------------------------------------------------------ table */}
        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="min-w-full divide-y text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                {[
                  "Serial no.",
                  "Date",
                  "Item",
                  "Qty",
                  "Supplier",
                  "Amount",
                  "Department",
                  "Indenter",
                  "Fund",
                  "Bill",
                ].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-gray-400">
                    Loading the register…
                  </td>
                </tr>
              )}

              {!loading && entries.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-gray-400">
                    {search || department || fy
                      ? "Nothing in the register matches those filters."
                      : "The register is empty. Entries appear here once a bill is finally approved."}
                  </td>
                </tr>
              )}

              {!loading &&
                entries.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-[#1c5a76]">
                      {e.serial_no}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                      {new Date(e.entry_date).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="max-w-[18rem] px-4 py-3">
                      <span className="block truncate" title={e.item_description ?? ""}>
                        {e.item_description ?? "—"}
                      </span>
                      <span className="text-xs text-gray-400">{e.item_category}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{e.qty ?? "—"}</td>
                    <td className="max-w-[14rem] px-4 py-3">
                      <span className="block truncate" title={e.supplier_name ?? ""}>
                        {e.supplier_name ?? "—"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      {money(e.amount)}
                    </td>
                    <td className="max-w-[14rem] px-4 py-3 text-gray-600">
                      <span className="block truncate" title={e.department}>
                        {e.department}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {e.employee_name ?? e.employee_code}
                      <span className="block text-xs text-gray-400">{e.employee_code}</span>
                    </td>
                    <td className="max-w-[12rem] px-4 py-3 text-gray-500">
                      <span className="block truncate" title={e.source_of_fund ?? ""}>
                        {e.source_of_fund ?? "—"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link
                        href={`/bill/${e.bill_id}`}
                        className="text-[#217093] hover:underline"
                        title={`Entered ${when(e.recorded_at)}`}
                      >
                        {e.bill_number ?? "View"}
                      </Link>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* --------------------------------------------------- paging */}
        {pages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
            <span>
              Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of{" "}
              {total.toLocaleString("en-IN")}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(p - 1, 0))}
                disabled={page === 0}
                className="rounded border px-3 py-1.5 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(p + 1, pages - 1))}
                disabled={page >= pages - 1}
                className="rounded border px-3 py-1.5 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
