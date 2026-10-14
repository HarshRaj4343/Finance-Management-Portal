"use client";

import { homeFor } from "@/lib/roles";
import React, { useEffect, useState } from "react";
import { api, money, qs, dateOnly } from "@/lib/api";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import AppShell, { canOpenPortalPages, sharedLinks } from "@/components/AppShell";
import { ExportButton, PageHeader, StatusBadge } from "@/components/ui/page";
import { BillWithEmployee } from "@/types/database";
import { Input } from "@/components/ui/input";

// Allowed departments from database types
const DEPARTMENTS = [
  "Staff Recruitment Section",
  "Dean Infrastructure (I&S)/Land Acquisition", 
  "Dean Resource Generation & Alumni Relations",
  "Central Dak Section",
  "Health Center",
  "School of Computing & Electrical Engineering",
  "School of Chemical Sciences",
  "School of Physical Sciences",
  "School of Mathematical & Statistical Sciences",
  "School of Biosciences & Bio Engineering",
  "School of Mechanical & Materials Engineering",
  "School of Civil & Environmental Engineering",
  "School of Humanities & Social Sciences",
  "School of Management",
  "Advanced Materials Research Center (AMRC)",
  "Centre of Artificial Intelligence and Robotics (CAIR)",
  "Center for Quantum Science and Technologies (CQST)",
  "Centre for Design & Fabrication of Electronic Devices (C4DFED)",
  "Center for Human-Computer Interaction (CHCI)",
  "Center for Climate Change and Disaster Management (C3DAR)",
  "IIT Mandi i-Hub & HCI",
  "IKSMHA Center",
  "Centre for Continuing Education (CCE)",
  "JEE CELL",
  "JAM",
  "GATE",
  "Office of Chief Warden",
  "Parashar Hostel",
  "Chandertaal Hostel",
  "Suvalsar Hostel",
  "Nako Hostel",
  "Dashir Hostel",
  "Beas Kund Hostel",
  "Manimahesh Hostel",
  "Suraj Taal Hostel",
  "Gauri Kund Hostel",
  "Central Mess",
  "Sports",
  "NSS",
  "Guidance & Counselling Cell",
  "Construction & Maintainance Cell",
  "Transportation",
  "Guest House",
  "Housekeeping Services & Waste Management",
  "Creche",
  "Security Unit",
  "Common Rooms",
  "Career & Placement Cell",
  "IIT Mandi Catalyst",
  "Recreation Center",
  "CPWD",
  "Banks",
  "IPDC",
  "IR",
  "Mind Tree School",
  "Renuka Hostel",
  "Rewalsar",
  "Director Office",
  "Deans",
  "Associate Deans",
  "Registrar Office",
  "Administration and Establishment Section",
  "Faculty Establishment and Recruitment",
  "Finance and Accounts",
  "Store and Purchase Section",
  "Rajbhasa Section",
  "Ranking Cell (RC)",
  "Media Cell",
  "Academics Section",
  "Academic Affairs",
  "Research Affairs",
  "Legal Section",
  "Internal Audit",
  "Central Library",
  "DIGITAL AND COMPUTING SERVICES",
  "Dean (SRIC & IR ) Office",
  "Dean (Students) Office",
];

const CATEGORIES = ["Minor", "Major", "Consumables"];

const PAGE_SIZE = 10;
const initialFilters = {
  category: "",
  employeeId: "",
  dept: "",
  billId: "",
  valueMin: "",
  valueMax: "",
  financeAdmin: "",
  dateFrom: "",
  dateTo: "",
};

const FINANCE_STATES = ["Pending", "Hold", "Approved", "Reject"];

/** The IST calendar day a timestamp falls on, as YYYY-MM-DD. */
function istDay(ts: string | null | undefined): string | null {
  if (!ts) return null;
  // Postgres text timestamps look like "2026-10-14 20:43:23.1+05:30" or "...+00".
  const date = new Date(ts.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}


export default function AllBillsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const role = session?.user?.employee_type;
  // RBAC: the portal-wide bill list is a Dean-only page.
  const allowed = status === "authenticated" && canOpenPortalPages(role);
  useEffect(() => {
    if (status === "unauthenticated") window.location.href = "/login";
    else if (status === "authenticated" && !canOpenPortalPages(role)) window.location.replace(homeFor(role));
  }, [status, role]);
  const [bills, setBills] = useState<BillWithEmployee[]>([]);
  const [filtered, setFiltered] = useState<BillWithEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  // Dashboards link here with a filter already chosen, e.g. ?finance_admin=Reject.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const fa = q.get("finance_admin") ?? "";
    const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
    setFilters((f) => ({
      ...f,
      financeAdmin: FINANCE_STATES.includes(fa) ? fa : "",
      dateFrom: day(q.get("from")),
      dateTo: day(q.get("to")),
    }));
  }, []);

  useEffect(() => {
    // Scoped by the server: a plain user gets only their own bills, an
    // approver gets the lot. The browser is not trusted to filter this.
    async function fetchBills() {
      setLoading(true);
      const { data, error: err } = await api.bills<{ bills: BillWithEmployee[] }>(
        "/api/bills?limit=500"
      );
      setLoading(false);

      if (err) {
        setError(err);
        return;
      }
      setError(null);
      setBills(data!.bills);
    }
    if (allowed) fetchBills();
  }, [allowed]);

  useEffect(() => {
    // If no filters are set, show all
    if (Object.values(filters).every((v) => !v)) {
      setFiltered(bills);
      setPage(1);
      return;
    }
    let result = [...bills];
    const { category, employeeId, dept, billId, valueMin, valueMax, financeAdmin, dateFrom, dateTo } = filters;
    
    // All filtering is case-sensitive - "User" and "USER" are treated as different values
    if (category) {
      result = result.filter(b => b.item_category === category);
    }
    if (employeeId.trim()) {
      result = result.filter(b => b.employee_id?.includes(employeeId.trim()));
    }
    if (dept) {
      result = result.filter(b => b.employee_department === dept);
    }
    if (billId.trim()) {
      result = result.filter(b => b.id?.toString().includes(billId.trim()));
    }
    if (valueMin.trim() || valueMax.trim()) {
      const min = valueMin.trim() ? parseFloat(valueMin) : -Infinity;
      const max = valueMax.trim() ? parseFloat(valueMax) : Infinity;
      result = result.filter(b => {
        const val = b.po_value ? Number(b.po_value) : 0;
        return val >= min && val <= max;
      });
    }
    if (financeAdmin) {
      result = result.filter(b => b.finance_admin === financeAdmin);
    }
    if (dateFrom || dateTo) {
      result = result.filter(b => {
        const day = istDay(b.created_at);
        return Boolean(day) && (!dateFrom || day! >= dateFrom) && (!dateTo || day! <= dateTo);
      });
    }
    setFiltered(result);
    setPage(1);
  }, [filters, bills]);

  // Pagination
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
  const billsToShow = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const field = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30";
  const th = "whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500";
  const anyFilter = Object.values(filters).some(Boolean);

  if (!allowed) return null;

  return (
    <AppShell desk="All Bills" nav={[]} links={sharedLinks(session?.user?.employee_type, "bills")}>
      <PageHeader
        title="All Bills"
        description="Every bill you are allowed to see, newest first. Select a row to open the bill."
        actions={<ExportButton href={"/api/bills" + qs({
          format: "csv", category: filters.category, department: filters.dept, finance_admin: filters.financeAdmin,
          min: filters.valueMin, max: filters.valueMax, from: filters.dateFrom, to: filters.dateTo,
          q: filters.billId.trim() || filters.employeeId.trim(),
        })} />}
      />

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Filters">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm"><span className="mb-1 block font-medium text-slate-700">Category</span>
            <select className={field} value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}>
              <option value="">All categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-sm"><span className="mb-1 block font-medium text-slate-700">Department</span>
            <select className={field} value={filters.dept || ""} onChange={e => setFilters(f => ({ ...f, dept: e.target.value }))}>
              <option value="">All departments</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="text-sm"><span className="mb-1 block font-medium text-slate-700">Finance Admin decision</span>
            <select className={field} value={filters.financeAdmin} onChange={e => setFilters(f => ({ ...f, financeAdmin: e.target.value }))}>
              <option value="">Any</option>
              {FINANCE_STATES.map(st => <option key={st} value={st}>{st === "Reject" ? "Rejected" : st}</option>)}
            </select>
          </label>
          <label className="text-sm"><span className="mb-1 block font-medium text-slate-700">Employee ID</span>
            <Input placeholder="e.g. E001" value={filters.employeeId} className={field} onChange={e => setFilters(f => ({ ...f, employeeId: e.target.value }))} />
          </label>
          <label className="text-sm"><span className="mb-1 block font-medium text-slate-700">Bill ID</span>
            <Input placeholder="Part of the bill ID" value={filters.billId} className={field} onChange={e => setFilters(f => ({ ...f, billId: e.target.value }))} />
          </label>
          <div className="text-sm"><span className="mb-1 block font-medium text-slate-700">Value (₹)</span>
            <div className="flex gap-2">
              <Input aria-label="Minimum value" placeholder="Min" type="number" value={filters.valueMin} className={field} onChange={e => setFilters(f => ({ ...f, valueMin: e.target.value }))} />
              <Input aria-label="Maximum value" placeholder="Max" type="number" value={filters.valueMax} className={field} onChange={e => setFilters(f => ({ ...f, valueMax: e.target.value }))} />
            </div>
          </div>
          <div className="text-sm sm:col-span-2"><span className="mb-1 block font-medium text-slate-700">Filed between</span>
            <div className="flex gap-2">
              <Input aria-label="Filed from" type="date" value={filters.dateFrom} max={filters.dateTo || undefined} className={field} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} />
              <Input aria-label="Filed to" type="date" value={filters.dateTo} min={filters.dateFrom || undefined} className={field} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} />
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
          <span>{loading ? "Loading…" : `${filtered.length} of ${bills.length} bills`}</span>
          {anyFilter && (
            <button type="button" onClick={() => setFilters(initialFilters)} className="rounded-md px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100">
              Clear filters
            </button>
          )}
        </div>
      </section>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className={th}>Bill</th>
                <th scope="col" className={th}>Employee</th>
                <th scope="col" className={`${th} text-right`}>Value</th>
                <th scope="col" className={th}>Category</th>
                <th scope="col" className={th}>Status</th>
                <th scope="col" className={th}>Store and Purchase</th>
                <th scope="col" className={th}>Audit</th>
                <th scope="col" className={th}>Finance Admin</th>
                <th scope="col" className={th}>Filed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
              ) : billsToShow.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                  {bills.length ? "No bills match these filters." : "No bills yet."}
                </td></tr>
              ) : billsToShow.map(bill => (
                <tr key={bill.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/bill/${bill.id}`)}>
                  <td className="max-w-xs px-4 py-3">
                    <Link href={`/bill/${bill.id}`} onClick={e => e.stopPropagation()} className="font-mono text-xs font-medium text-blue-700 hover:underline">
                      {bill.bill_number ?? bill.id.slice(0, 8)}
                    </Link>
                    <p className="truncate text-slate-700" title={bill.po_details ?? ""}>{bill.po_details || "—"}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="whitespace-nowrap font-medium text-slate-900">{bill.employee_id || "—"}</p>
                    <p className="max-w-[14rem] truncate text-xs text-slate-500" title={bill.employee_department ?? ""}>{bill.employee_department || "—"}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(bill.po_value)}</td>
                  <td className="whitespace-nowrap px-4 py-3">{bill.item_category}</td>
                  <td className="px-4 py-3"><StatusBadge value={bill.status} /></td>
                  <td className="px-4 py-3"><StatusBadge value={bill.snp} /></td>
                  <td className="px-4 py-3"><StatusBadge value={bill.audit} /></td>
                  <td className="px-4 py-3"><StatusBadge value={bill.finance_admin} /></td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{dateOnly(bill.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
          <span>Showing {billsToShow.length} of {filtered.length} bills</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="h-8 rounded-md border border-slate-300 bg-white px-3 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Previous</button>
            <span>Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="h-8 rounded-md border border-slate-300 bg-white px-3 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Next</button>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
