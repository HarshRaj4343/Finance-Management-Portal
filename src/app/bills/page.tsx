"use client";

import { deskLabel } from "@/lib/roles";
import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { BillWithEmployee } from "@/types/database";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableCell, TableHead } from "@/components/ui/table";

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

function getStatusColor(status: string | null | undefined) {
  switch (status) {
    case "Pending": return "text-yellow-600 bg-yellow-100";
    case "Approved": return "text-green-600 bg-green-100";
    case "Reject": return "text-red-600 bg-red-100";
    case "Hold": return "text-orange-600 bg-orange-100";
    default: return "text-gray-600 bg-gray-100";
  }
}

export default function AllBillsPage() {
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
    fetchBills();
  }, []);

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

  // Collect options - using fixed categories

  return (
    <div className="h-screen flex flex-col">
      <div className="flex-shrink-0 p-4 pb-2">
        <div className="flex flex-wrap items-end gap-4 mb-3 justify-between">
          <h2 className="text-2xl font-semibold">All Bills History</h2>
          <div className="flex flex-wrap gap-2 items-end">
          <select
            className="border rounded-md h-9 px-2 text-sm"
            value={filters.category}
            onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}
          >
            <option value="">Category</option>
            {CATEGORIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <Input
            placeholder="Employee ID"
            value={filters.employeeId}
            className="w-32"
            onChange={e => setFilters(f => ({ ...f, employeeId: e.target.value }))}
          />
          <select
            className="border rounded-md h-9 px-2 text-sm"
            value={filters.dept || ''}
            onChange={e => setFilters(f => ({ ...f, dept: e.target.value }))}
          >
            <option value="">Department</option>
            {DEPARTMENTS.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <Input
            placeholder="Bill ID"
            value={filters.billId}
            className="w-36"
            onChange={e => setFilters(f => ({ ...f, billId: e.target.value }))}
          />
          <Input
            placeholder="Bill Value Min"
            type="number"
            value={filters.valueMin}
            className="w-32"
            onChange={e => setFilters(f => ({ ...f, valueMin: e.target.value }))}
          />
          <Input
            placeholder="Bill Value Max"
            type="number"
            value={filters.valueMax}
            className="w-32"
            onChange={e => setFilters(f => ({ ...f, valueMax: e.target.value }))}
          />
          <select
            aria-label="Finance Admin decision"
            className="border rounded-md h-9 px-2 text-sm"
            value={filters.financeAdmin}
            onChange={e => setFilters(f => ({ ...f, financeAdmin: e.target.value }))}
          >
            <option value="">Finance Admin</option>
            {FINANCE_STATES.map(s => (
              <option key={s} value={s}>{s === "Reject" ? "Rejected" : s}</option>
            ))}
          </select>
          <label className="flex flex-col text-xs text-gray-600">
            Filed from
            <Input
              type="date"
              value={filters.dateFrom}
              max={filters.dateTo || undefined}
              className="w-40"
              onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
            />
          </label>
          <label className="flex flex-col text-xs text-gray-600">
            Filed to
            <Input
              type="date"
              value={filters.dateTo}
              min={filters.dateFrom || undefined}
              className="w-40"
              onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
            />
          </label>
          {Object.values(filters).some(Boolean) && (
            <button
              type="button"
              onClick={() => setFilters(initialFilters)}
              className="h-9 px-3 text-sm rounded-md border bg-white hover:bg-gray-50"
            >
              Clear filters
            </button>
          )}
        </div>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-3 mx-4">
            {error}
          </div>
        )}
      </div>

      <div className="flex-1 mx-4 mb-4 overflow-hidden">
        <div className="h-full bg-gray-100 rounded shadow-md flex flex-col">
          <div className="flex-1 overflow-hidden">
            <Table className="h-full">
              <TableHeader>
                <TableRow className="h-10">
                  <TableHead className="py-3">Employee ID</TableHead>
                  <TableHead className="py-3">Department</TableHead>
                  <TableHead className="py-3">PO Details</TableHead>
                  <TableHead className="py-3">PO Value</TableHead>
                  <TableHead className="py-3">Category</TableHead>
                  <TableHead className="py-3">Status</TableHead>
                  <TableHead className="py-3">Store and Purchase Department</TableHead>
                  <TableHead className="py-3">Audit</TableHead>
                  <TableHead className="py-3">Finance Admin</TableHead>
                  <TableHead className="py-3">Created At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="bg-white">
              {loading ? (
                <TableRow className="h-12">
                  <TableCell colSpan={10} className="py-4">
                    <div className="flex items-center justify-center h-16">Loading...</div>
                  </TableCell>
                </TableRow>
              ) : billsToShow.length === 0 ? (
                <TableRow className="h-12">
                  <TableCell colSpan={10} className="py-4">
                    <div className="text-center p-6 text-gray-500">
                      No bills found. Total bills in DB: {bills.length}
                    </div>
                  </TableCell>
                </TableRow>
              ) : billsToShow.map(bill => (
                <TableRow key={bill.id} className="h-12 hover:bg-gray-50">
                  <TableCell className="py-3">{bill.employee_id || "N/A"}</TableCell>
                  <TableCell className="py-3">{bill.employee_department || "N/A"}</TableCell>
                  <TableCell className="py-3">{bill.po_details || "N/A"}</TableCell>
                  <TableCell className="py-3">₹ {bill.po_value?.toLocaleString() || '-'}</TableCell>
                  <TableCell className="py-3"><span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">{bill.item_category}</span></TableCell>
                  <TableCell className="py-3"><span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(bill.status)}`}>{deskLabel(bill.status)}</span></TableCell>
                  <TableCell className="py-3">{bill.snp ? <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(bill.snp)}`}>{bill.snp}</span> : 'N/A'}</TableCell>
                  <TableCell className="py-3">{bill.audit ? <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(bill.audit)}`}>{bill.audit}</span> : 'N/A'}</TableCell>
                  <TableCell className="py-3">{bill.finance_admin ? <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(bill.finance_admin)}`}>{bill.finance_admin}</span> : 'N/A'}</TableCell>
                  <TableCell className="py-3">{bill.created_at ? new Date(bill.created_at ?? '').toLocaleDateString() : '-'}</TableCell>
                </TableRow>
              ))}
              </TableBody>
            </Table>
          </div>
          {/* Pagination */}
          <div className="flex-shrink-0 flex justify-between items-center py-3 px-4 border-t bg-gray-50 rounded-b">
            <div className="text-sm text-gray-600">Showing {billsToShow.length} of {filtered.length} bills</div>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 bg-gray-100 rounded disabled:opacity-50">Prev</button>
              <span className="px-2">Page {page} of {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 bg-gray-100 rounded disabled:opacity-50">Next</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
