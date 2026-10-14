"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  IconListDetails,
  IconBook,
  IconCalendar,
  IconBuildingBank,
} from "@tabler/icons-react";
import { api, money, qs, when } from "@/lib/api";
import Notice, { NoticeState } from "@/components/Notice";
import AppShell, { canOpenPortalPages, sharedLinks } from "@/components/AppShell";
import FilterBar, { FilterField, filterInput } from "@/components/FilterBar";
import { PageHeader, StatCard } from "@/components/ui/page";
import { homeFor, normaliseRole } from "@/lib/roles";
import type { RegisterEntry, DepartmentRow } from "@/types/database";

/**
 * The departmental purchase register.
 *
 * One line per purchase that completed the approval workflow, under a
 * running serial number, so "where is this logged" has an answer. Entries
 * are cut automatically at final approval and can never be edited or
 * deleted -- the database refuses both. There is deliberately no way to
 * add a line by hand.
 */

type Totals = {
  entries: number;
  amount: number;
  departments: number;
  financial_year: string | null;
  current_year: string;
};



export default function RegisterPage() {
  const { data: session, status } = useSession();

  const [entries, setEntries] = useState<RegisterEntry[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [years, setYears] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [department, setDepartment] = useState("");
  const [fy, setFy] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const role = normaliseRole((session?.user as { employee_type?: string })?.employee_type);
  const scoped = role === "User";

  // RBAC: the purchase register is a Dean-only page; the API refuses everyone else too.
  const allowed = status === "authenticated" && canOpenPortalPages(role);
  useEffect(() => {
    if (status === "unauthenticated") window.location.href = "/login";
    else if (status === "authenticated" && !canOpenPortalPages(role)) window.location.replace(homeFor(role));
  }, [status, role]);

  useEffect(() => {
    if (!allowed) return;
    api
      .get<{ departments: DepartmentRow[] }>("/api/departments")
      .then(({ data }) => data && setDepartments(data.departments));
  }, [allowed]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await api.get<{
      entries: RegisterEntry[];
      total: number;
      totals: Totals;
      financialYears: string[];
    }>(
      "/api/register" +
        qs({ q: searchQuery, department, fy, limit: pageSize, offset: page * pageSize })
    );
    setLoading(false);

    if (error) {
      setNotice({ kind: "bad", text: error });
      return;
    }
    setEntries(data!.entries);
    setTotal(data!.total);
    setTotals(data!.totals);
    setYears(data!.financialYears);
  }, [searchQuery, department, fy, page]);

  useEffect(() => {
    if (!allowed) return;
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [allowed, load]);


  const pages = Math.ceil(total / pageSize);

  const links = [
    {
      label: "All Entries",
      icon: <IconListDetails className="h-5 w-5 shrink-0 text-blue-600" />,
      onClick: () => {
        setActiveFilter("All");
        setFy("");
        setDepartment("");
        setPage(0);
      },
    },
    {
      label: "This Year",
      icon: <IconCalendar className="h-5 w-5 shrink-0 text-green-600" />,
      onClick: () => {
        setActiveFilter("This Year");
        setFy(totals?.current_year ?? "");
        setPage(0);
      },
    },
    {
      label: "My Department",
      icon: <IconBuildingBank className="h-5 w-5 shrink-0 text-yellow-600" />,
      onClick: () => {
        setActiveFilter("My Department");
        setDepartment(
          ((session?.user as { department?: string })?.department as string) ?? ""
        );
        setPage(0);
      },
    },
  ];

  const clearAll = () => {
    setSearchQuery("");
    setDepartment("");
    setFy("");
    setActiveFilter("All");
    setPage(0);
  };

  if (!allowed) return null;

  return (
    <AppShell
      desk="Purchase Register"
      nav={links.map((link) => ({ label: link.label, icon: link.icon, onClick: link.onClick, active: activeFilter === link.label }))}
      links={sharedLinks(session?.user?.employee_type, "register")}
    >
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
      <PageHeader
        title="Purchase Register"
        description={scoped
          ? "Your purchases, as entered in the departmental register."
          : "Every purchase that completed the approval workflow."}
      />

        {totals && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StatCard label="Entries" value={totals.entries.toLocaleString("en-IN")} hint="Recorded purchases" tone="blue" />
            <StatCard label="Total Value" value={money(totals.amount)} hint="Across these entries" tone="green" />
            <StatCard label="Departments" value={totals.departments} hint="With recorded purchases" tone="amber" />
          </div>
        )}

        <FilterBar
          search={searchQuery}
          onSearch={(value) => { setPage(0); setSearchQuery(value); }}
          placeholder="Search by serial number, item, supplier or employee"
          onClear={clearAll}
          active={Boolean(searchQuery || department || fy)}
        >
          <FilterField label="Department">
            <select value={department} onChange={(e) => { setPage(0); setDepartment(e.target.value); }} className={filterInput}>
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.name} value={d.name}>{d.name}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Financial year">
            <select value={fy} onChange={(e) => { setPage(0); setFy(e.target.value); }} className={filterInput}>
              <option value="">All years</option>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </FilterField>
        </FilterBar>

        {/* The register itself */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b bg-slate-50 flex items-center gap-2">
            <IconBook className="h-5 w-5 text-blue-600" />
            <h2 className="font-semibold text-gray-800">Register Entries</h2>
            <span className="ml-auto text-sm text-gray-500">
              {total.toLocaleString("en-IN")} total
            </span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="ml-3 text-gray-600">Loading the register...</span>
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <IconBook className="h-10 w-10 mx-auto mb-3 text-gray-300" />
              <p>
                {searchQuery || department || fy
                  ? "Nothing in the register matches those filters."
                  : "The register is empty."}
              </p>
              <p className="text-sm text-gray-400 mt-1">
                Entries appear here once a bill is finally approved.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {[
                      "Serial No.",
                      "Date",
                      "Item",
                      "Qty",
                      "Supplier",
                      "Amount",
                      "Department",
                      "Indenter",
                      "Bill",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {entries.map((e) => (
                    <tr key={e.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap font-medium text-blue-700">
                        {e.serial_no}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                        {new Date(e.entry_date).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <span className="block truncate" title={e.item_description ?? ""}>
                          {e.item_description ?? "—"}
                        </span>
                        <span className="text-xs text-gray-400">{e.item_category}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{e.qty ?? "—"}</td>
                      <td className="px-4 py-3 max-w-[12rem]">
                        <span className="block truncate" title={e.supplier_name ?? ""}>
                          {e.supplier_name ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-800">
                        {money(e.amount)}
                      </td>
                      <td className="px-4 py-3 max-w-[13rem] text-gray-600">
                        <span className="block truncate" title={e.department}>
                          {e.department}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {e.employee_name ?? e.employee_code}
                        <span className="block text-xs text-gray-400">
                          {e.employee_code}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <a
                          href={`/bill/${e.bill_id}`}
                          className="text-blue-600 hover:underline"
                          title={`Entered ${when(e.recorded_at)}`}
                        >
                          {e.bill_number ?? "View"}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-gray-600">
              <span>
                Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of{" "}
                {total.toLocaleString("en-IN")}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(p - 1, 0))}
                  disabled={page === 0}
                  className="px-3 py-1.5 border rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(p + 1, pages - 1))}
                  disabled={page >= pages - 1}
                  className="px-3 py-1.5 border rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-xs text-gray-400 text-center pb-4">
          Register entries are permanent. They cannot be edited or deleted once written.
        </p>
    </AppShell>
  );
}
