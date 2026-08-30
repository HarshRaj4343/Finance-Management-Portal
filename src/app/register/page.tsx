"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { signOut, useSession } from "next-auth/react";
import {
  IconArrowLeft,
  IconHome,
  IconListDetails,
  IconSearch,
  IconFilter,
  IconBook,
  IconCalendar,
  IconBuildingBank,
} from "@tabler/icons-react";
import { Sidebar, SidebarBody } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { api, money, qs, when } from "@/lib/api";
import Notice, { NoticeState } from "@/components/Notice";
import { normaliseRole } from "@/lib/roles";
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
  financial_year: string;
};

const Logo = () => (
  <a
    href="#"
    className="relative z-20 flex items-center space-x-2 py-1 text-base font-semibold text-black"
  >
    <img src="/iit.png" alt="IIT Mandi" className="h-8 w-8" />
    <motion.span
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="whitespace-pre text-black"
    >
      Purchase Register
    </motion.span>
  </a>
);

const LogoIcon = () => (
  <a
    href="#"
    className="relative z-20 flex items-center py-1 text-sm font-semibold text-black"
  >
    <img src="/iit.png" alt="IIT Mandi" className="h-8 w-8" />
  </a>
);

export default function RegisterPage() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);

  const [entries, setEntries] = useState<RegisterEntry[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [total, setTotal] = useState(0);

  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [department, setDepartment] = useState("");
  const [fy, setFy] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const role = normaliseRole((session?.user as { employee_type?: string })?.employee_type);
  const scoped = role === "User";

  useEffect(() => {
    if (status === "unauthenticated") window.location.href = "/login";
  }, [status]);

  useEffect(() => {
    api
      .get<{ departments: DepartmentRow[] }>("/api/departments")
      .then(({ data }) => data && setDepartments(data.departments));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await api.get<{
      entries: RegisterEntry[];
      total: number;
      totals: Totals;
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
  }, [searchQuery, department, fy, page]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [status, load]);

  // The financial years actually present, newest first.
  const years = useMemo(() => {
    const set = new Set(entries.map((e) => e.financial_year));
    if (totals?.financial_year) set.add(totals.financial_year);
    return [...set].sort().reverse();
  }, [entries, totals]);

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
        setFy(totals?.financial_year ?? "");
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

  return (
    <div className="flex w-full h-screen bg-white shadow-lg">
      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      {/* Sidebar */}
      <Sidebar open={open} setOpen={setOpen}>
        <SidebarBody className="flex flex-col justify-between h-full">
          <div className="flex flex-col">
            {open ? <Logo /> : <LogoIcon />}
            <div className="mt-8 flex flex-col gap-2">
              {links.map((link, idx) => (
                <button
                  key={idx}
                  onClick={link.onClick}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded text-left w-full transition-colors",
                    activeFilter === link.label
                      ? "bg-blue-100 font-medium text-blue-900"
                      : "hover:bg-gray-100"
                  )}
                >
                  {link.icon}
                  {open && <span>{link.label}</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Bottom links */}
          <div className="flex flex-col gap-2">
            <button
              onClick={() => (window.location.href = "/")}
              className="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 text-left w-full"
            >
              <IconHome className="h-5 w-5 shrink-0 text-neutral-700" />
              {open && <span>Portal</span>}
            </button>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 text-left w-full"
            >
              <IconArrowLeft className="h-5 w-5 shrink-0 text-neutral-700" />
              {open && <span>Logout</span>}
            </button>
          </div>
        </SidebarBody>
      </Sidebar>

      {/* Main Content */}
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-8 overflow-y-auto bg-gray-50">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-2">
            Purchase Register
          </h1>
          <p className="text-gray-600 font-medium">
            {scoped
              ? "Your purchases, as entered in the departmental register"
              : "Every purchase that completed the approval workflow"}
          </p>
        </motion.div>

        {/* Summary cards */}
        {totals && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="rounded-lg bg-blue-50 shadow p-6 border border-blue-200"
            >
              <h2 className="text-gray-600 text-sm">Entries</h2>
              <p className="text-2xl font-bold text-blue-700">
                {totals.entries.toLocaleString("en-IN")}
              </p>
              <p className="text-xs text-gray-500 mt-1">Recorded purchases</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="rounded-lg bg-green-50 shadow p-6 border border-green-200"
            >
              <h2 className="text-gray-600 text-sm">Total Value</h2>
              <p className="text-2xl font-bold text-green-700">{money(totals.amount)}</p>
              <p className="text-xs text-gray-500 mt-1">Across all entries</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="rounded-lg bg-yellow-50 shadow p-6 border border-yellow-200"
            >
              <h2 className="text-gray-600 text-sm">Departments</h2>
              <p className="text-2xl font-bold text-yellow-700">{totals.departments}</p>
              <p className="text-xs text-gray-500 mt-1">With recorded purchases</p>
            </motion.div>
          </div>
        )}

        {/* Search and Filter Section */}
        <div className="bg-white rounded-lg shadow p-4 space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <IconSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by serial number, item, supplier, employee..."
                value={searchQuery}
                onChange={(e) => {
                  setPage(0);
                  setSearchQuery(e.target.value);
                }}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                showFilters
                  ? "bg-blue-100 text-blue-700 border-blue-300"
                  : "bg-gray-100 text-gray-700 border-gray-300"
              }`}
            >
              <IconFilter className="h-5 w-5" />
              Filters
            </button>
            <button
              onClick={clearAll}
              className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Clear All
            </button>
          </div>

          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t"
              >
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <IconBuildingBank className="inline h-4 w-4 mr-1" />
                    Department
                  </label>
                  <select
                    value={department}
                    onChange={(e) => {
                      setPage(0);
                      setDepartment(e.target.value);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">All departments</option>
                    {departments.map((d) => (
                      <option key={d.name} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <IconCalendar className="inline h-4 w-4 mr-1" />
                    Financial Year
                  </label>
                  <select
                    value={fy}
                    onChange={(e) => {
                      setPage(0);
                      setFy(e.target.value);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">All years</option>
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* The register itself */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center gap-2">
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
      </div>
    </div>
  );
}
