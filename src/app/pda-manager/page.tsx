
"use client";

import { useEffect, useMemo, useState } from "react";
import { api, money } from "@/lib/api";
import Notice, { NoticeState } from "@/components/Notice";
import { normaliseRole } from "@/lib/roles";
import type { PdaBalanceRow } from "@/types/database";
import { useSession, signOut } from "next-auth/react";

/**
 * Small local Sidebar implementation (drop-in).
 * If you already have a Sidebar component, you can replace these exports/imports.
 */
function IconArrowLeft(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Sidebar({
  open,
  setOpen,
  className,
  children,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  className?: string;
  children?: React.ReactNode;
}) {
  // sidebar root uses width toggle w-64 (open) / w-20 (closed)
  return (
    <aside
      className={`relative z-10 flex flex-col transition-all duration-200 ease-in-out overflow-hidden border-r border-neutral-200 bg-white ${
        open ? "w-64" : "w-20"
      } ${className ?? ""}`}
      aria-hidden={!open}
    >
      {/* top toggle */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-neutral-100">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded bg-neutral-100" >
            <img src='./iit.png'/>
            </div>
          {open && <span className="font-semibold text-neutral-800">IIT Mandi</span>}
        </div>
        <button
          onClick={() => setOpen(!open)}
          aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
          className="rounded px-2 py-1 text-neutral-600 hover:bg-neutral-100"
        >
          {open ? "«" : "»"}
        </button>
      </div>

      <div className="flex-1 overflow-auto">{children}</div>
    </aside>
  );
}

function SidebarBody({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <div className={className}>{children}</div>;
}

/* -------------------------------------------------------------------------- */
/* ---------------------------- PDA Manager Page ---------------------------- */
/* -------------------------------------------------------------------------- */

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

// The shared row type, plus the name the API joins on from `employees`.
type PdaBalance = PdaBalanceRow & {
  employee_name?: string | null;
  employee_type?: string | null;
};

export default function PdaManagerPage() {
  const { data: session, status } = useSession();

  // sidebar open state
  const [open, setOpen] = useState(true);

  const [rows, setRows] = useState<PdaBalance[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const [isAdding, setIsAdding] = useState(false);
  const [editing, setEditing] = useState<PdaBalance | null>(null);

  const [form, setForm] = useState({
    employee_id: "",
    balance: 0,
    department: "",
    email: "",
  });

  const pageFrom = useMemo(() => (page - 1) * pageSize, [page, pageSize]);
  const pageTo = useMemo(() => pageFrom + pageSize - 1, [pageFrom, pageSize]);

  useEffect(() => {
    if (status === "loading") return;

    if (status === "unauthenticated") {
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
      return;
    }

    const role = normaliseRole((session as any)?.user?.employee_type);
    if (session && role !== "PDA Manager" && role !== "Dean") {
      window.location.href = "/";
    }
  }, [status, session]);

  const [notice, setNotice] = useState<NoticeState>(null);

  /**
   * A PDA account is four numbers, not one:
   *
   *     allocated = balance + committed + spent
   *
   * `balance` is what is free to commit to a new bill, `committed` is
   * reserved by bills still moving through the workflow, and `spent` is
   * gone for good. Writing `balance` directly -- which this page used to
   * do -- can hand out money that is already promised to a bill in flight.
   *
   * So every change here sets the *allocation*, and the database derives
   * the free balance from it. fn_set_pda_allocation refuses to cut an
   * allocation below what is already committed or spent.
   */
  const fetchPaged = async () => {
    setLoading(true);
    const { data, error } = await api.get<{ accounts: PdaBalance[]; total: number }>(
      `/api/admin/pda${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ""}`
    );
    setLoading(false);
    if (error) {
      setNotice({ kind: "bad", text: error });
      return;
    }
    setRows(data!.accounts.slice(pageFrom, pageTo + 1) as PdaBalance[]);
    setTotal(data!.total);
  };

  useEffect(() => {
    fetchPaged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, search]);

  const resetForm = () =>
    setForm({ employee_id: "", balance: 0, department: "", email: "" });

  const refreshToFirstPage = async () => {
    setPage(1);
    await fetchPaged();
  };

  const handleAdd = async () => {
    const code = form.employee_id.trim();
    if (!code) {
      setNotice({ kind: "bad", text: "An employee ID is required." });
      return;
    }

    setLoading(true);
    // Department and email are taken from the employees table, so an
    // account can never disagree with the person it belongs to.
    const { error } = await api.post("/api/admin/pda", {
      employee_id: code,
      allocated: Number.isFinite(form.balance) ? form.balance : 0,
    });
    setLoading(false);

    if (error) {
      setNotice({ kind: "bad", text: error });
      return;
    }
    setIsAdding(false);
    resetForm();
    setNotice({ kind: "ok", text: `PDA account opened for ${code}.` });
    await refreshToFirstPage();
  };

  const handleUpdate = async () => {
    if (!editing) return;
    setLoading(true);
    const { data, error } = await api.patch<{ account: PdaBalance }>("/api/admin/pda", {
      employee_id: editing.employee_id.trim(),
      allocated: Number.isFinite(editing.balance) ? Number(editing.balance) : 0,
    });
    setLoading(false);

    if (error) {
      setNotice({ kind: "bad", text: error });
      return;
    }
    setEditing(null);
    setNotice({
      kind: "ok",
      text: `Allocation set. ${money(Number(data!.account.balance))} is now free to commit.`,
    });
    await refreshToFirstPage();
  };

  const handleDelete = async (employeeId: string) => {
    if (!confirm(`Close the PDA account for ${employeeId}?`)) return;
    setLoading(true);
    const { error } = await api.del(
      `/api/admin/pda?employee_id=${encodeURIComponent(employeeId)}`
    );
    setLoading(false);

    if (error) {
      setNotice({ kind: "bad", text: error });
      return;
    }
    const newTotal = Math.max(total - 1, 0);
    const maxPage = Math.max(Math.ceil(newTotal / pageSize), 1);
    if (page > maxPage) setPage(maxPage);
    setNotice({ kind: "ok", text: `PDA account for ${employeeId} closed.` });
    await fetchPaged();
  };

  const handleAddAmountToAll = async () => {
    const raw = prompt("Amount to add to every PDA allocation:");
    if (raw == null) return;
    const delta = parseFloat(raw);
    if (!Number.isFinite(delta)) {
      setNotice({ kind: "bad", text: "That is not a valid amount." });
      return;
    }

    setLoading(true);
    const { data } = await api.get<{ accounts: PdaBalance[] }>("/api/admin/pda");
    const accounts = data?.accounts ?? [];

    const refused: string[] = [];
    for (const a of accounts) {
      const { error } = await api.patch("/api/admin/pda", {
        employee_id: a.employee_id,
        top_up: delta,
      });
      if (error) refused.push(a.employee_id);
    }
    setLoading(false);
    await fetchPaged();

    setNotice(
      refused.length
        ? {
            kind: "bad",
            text: `${accounts.length - refused.length} of ${accounts.length} accounts updated. Refused: ${refused.join(", ")}.`,
          }
        : { kind: "ok", text: `${money(delta)} added to ${accounts.length} allocations.` }
    );
  };

  const handleResetAll = async () => {
    if (
      !confirm(
        "Reduce every allocation to what is already committed or spent?\n\n" +
          "This leaves nothing free for new bills. Money already promised to " +
          "bills in progress is not touched. This cannot be undone."
      )
    )
      return;

    setLoading(true);
    const { data } = await api.get<{ accounts: PdaBalance[] }>("/api/admin/pda");
    const accounts = data?.accounts ?? [];

    let done = 0;
    for (const a of accounts) {
      // The floor: an allocation may never go below committed + spent.
      const floor = Number(a.committed) + Number(a.spent);
      const { error } = await api.patch("/api/admin/pda", {
        employee_id: a.employee_id,
        allocated: floor,
      });
      if (!error) done += 1;
    }
    setLoading(false);
    await fetchPaged();
    setNotice({
      kind: "ok",
      text: `${done} of ${accounts.length} allocations reduced to their committed and spent totals.`,
    });
  };

  const start = total === 0 ? 0 : pageFrom + 1;
  const end = Math.min(pageFrom + rows.length, total);
  const canPrev = page > 1;
  const canNext = page * pageSize < total;

  return (
    <div className="min-h-screen flex bg-neutral-50">
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
      {/* Sidebar (left) */}
     <Sidebar open={open} setOpen={setOpen} className="hidden md:flex">
  <SidebarBody className="flex flex-col h-full p-0">

    

    {/* Divider */}
    <div className="border-b border-neutral-300"></div>

    {/* Logout button ONLY */}
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="w-full text-left px-4 py-3 text-neutral-800 hover:bg-neutral-100"
    >
      {open ? "Logout" : "⟵"}
    </button>

  </SidebarBody>
</Sidebar>




      {/* Main content */}
      <main className="flex-1">
        {/* full width wrapper with padding; removes mx-auto max-w-7xl to use full width */}
        <div className="w-full px-6 py-6">
          {/* Header */}
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-neutral-900">PDA Manager</h1>
              <p className="text-sm text-neutral-500">Manage PDA members, balances, and departments.</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setIsAdding(true)} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700">
                Add Member
              </button>
              <button onClick={handleAddAmountToAll} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
                Add Amount to All
              </button>
              <button onClick={handleResetAll} className="rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-rose-700">
                Reset All to Zero
              </button>
            </div>
          </div>

          {/* Card */}
          <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
            {/* Controls row */}
            <div className="flex flex-col gap-3 border-b border-neutral-200 px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2">
                <input
                  placeholder="Search employee, department or email..."
                  value={search}
                  onChange={(e) => {
                    setPage(1);
                    setSearch(e.target.value);
                  }}
                  className="w-72 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <div className="text-sm text-neutral-600">
                  Showing {start}-{end} of {total}
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="min-w-full table-auto text-sm">
                <thead className="sticky top-0 z-10 bg-neutral-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-neutral-600">Employee ID</th>
                    <th className="px-4 py-3 text-left font-medium text-neutral-600">Balance</th>
                    <th className="px-4 py-3 text-left font-medium text-neutral-600">Department</th>
                    <th className="px-4 py-3 text-left font-medium text-neutral-600">Email</th>
                    <th className="px-4 py-3 text-left font-medium text-neutral-600">Last Updated</th>
                    <th className="px-4 py-3 text-left font-medium text-neutral-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={r.id} className={idx % 2 === 0 ? "bg-white" : "bg-neutral-50 hover:bg-neutral-100"}>
                      <td className="px-4 py-3 font-medium text-neutral-900">{r.employee_id}</td>
                      <td className="px-4 py-3 text-neutral-900">{r.balance}</td>
                      <td className="px-4 py-3 text-neutral-900">{r.department}</td>
                      <td className="px-4 py-3 text-neutral-900">{r.email ?? "-"}</td>
                      <td className="px-4 py-3 text-neutral-900">{r.updated_at ? new Date(r.updated_at).toLocaleString() : "-"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <button onClick={() => setEditing(r)} className="text-blue-600 hover:text-blue-700">
                            Edit
                          </button>
                          <button onClick={() => handleDelete(r.id)} className="text-rose-600 hover:text-rose-700">
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {!loading && rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-neutral-500">
                        No records found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer / Pagination */}
            <div className="flex flex-col items-center justify-between gap-3 border-t border-neutral-200 px-4 py-3 md:flex-row">
              <div className="text-sm text-neutral-600">Showing {start}-{end} of {total}</div>

              <div className="flex items-center gap-3">
                <label className="text-sm text-neutral-600">Rows per page</label>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPage(1);
                    setPageSize(parseInt(e.target.value, 10));
                  }}
                  className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
                >
                  {[5, 10, 20, 50].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>

                <div className="flex items-center gap-1">
                  <button
                    disabled={!canPrev}
                    onClick={() => canPrev && setPage((p) => p - 1)}
                    className={`rounded-md px-3 py-1 text-sm ${canPrev ? "text-neutral-700 hover:bg-neutral-100" : "cursor-not-allowed text-neutral-400"}`}
                  >
                    Prev
                  </button>
                  <span className="text-sm text-neutral-600">Page {page} of {Math.max(Math.ceil(total / pageSize), 1)}</span>
                  <button
                    disabled={!canNext}
                    onClick={() => canNext && setPage((p) => p + 1)}
                    className={`rounded-md px-3 py-1 text-sm ${canNext ? "text-neutral-700 hover:bg-neutral-100" : "cursor-not-allowed text-neutral-400"}`}
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Add Member Modal */}
          {isAdding && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-5xl rounded-xl border border-neutral-200 bg-white p-6 shadow-xl">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-neutral-900">Add Member</h2>
                  <button onClick={() => setIsAdding(false)} className="rounded-md px-2 py-1 text-neutral-500 hover:bg-neutral-100">
                    ✕
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <input type="text" placeholder="Employee ID" value={form.employee_id} onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))} className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none" />
                  <input type="number" placeholder="Balance" value={String(form.balance)} onChange={(e) => setForm((f) => ({ ...f, balance: e.target.value === "" ? 0 : parseFloat(e.target.value) }))} className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none" />
                  <select value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none">
                    <option value="">Select Department</option>
                    {DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none" />
                </div>

                <div className="mt-6 flex items-center justify-end gap-2">
                  <button onClick={() => setIsAdding(false)} className="rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100">
                    Cancel
                  </button>
                  <button onClick={handleAdd} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700">
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Edit Member Modal */}
          {editing && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-5xl rounded-xl border border-neutral-200 bg-white p-6 shadow-xl">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-neutral-900">Edit Member</h2>
                  <button onClick={() => setEditing(null)} className="rounded-md px-2 py-1 text-neutral-500 hover:bg-neutral-100">
                    ✕
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <input type="text" placeholder="Employee ID" value={editing.employee_id} onChange={(e) => setEditing((prev) => (prev ? { ...prev, employee_id: e.target.value } : prev))} className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none" />
                  <input type="number" placeholder="Balance" value={String(editing.balance)} onChange={(e) => setEditing((prev) => (prev ? { ...prev, balance: e.target.value === "" ? 0 : parseFloat(e.target.value) } : prev))} className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none" />
                  <select value={editing.department} onChange={(e) => setEditing((prev) => (prev ? { ...prev, department: e.target.value } : prev))} className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none">
                    <option value="">Select Department</option>
                    {DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <input type="email" placeholder="Email" value={editing.email ?? ""} onChange={(e) => setEditing((prev) => (prev ? { ...prev, email: e.target.value } : prev))} className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none" />
                </div>

                <div className="mt-6 flex items-center justify-end gap-2">
                  <button onClick={() => setEditing(null)} className="rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100">
                    Cancel
                  </button>
                  <button onClick={handleUpdate} className="rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-green-700">
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Loading overlay */}
          {loading && (
            <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/20">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-white border-t-blue-600" />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
