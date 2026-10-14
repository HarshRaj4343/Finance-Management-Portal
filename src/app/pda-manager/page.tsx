
"use client";

import { useEffect, useMemo, useState } from "react";
import { api, money, when } from "@/lib/api";
import Notice, { NoticeState } from "@/components/Notice";
import AppShell from "@/components/AppShell";
import Modal from "@/components/ui/modal";
import { ExportButton, PageHeader } from "@/components/ui/page";
import { IconWallet } from "@tabler/icons-react";
import { normaliseRole } from "@/lib/roles";
import { useConfirm } from "@/components/ConfirmProvider";
import type { PdaBalanceRow } from "@/types/database";
import { useSession } from "next-auth/react";

/* -------------------------------------------------------------------------- */
/* ---------------------------- PDA Manager Page ---------------------------- */
/* -------------------------------------------------------------------------- */


// The shared row type, plus the name the API joins on from `employees`.
type PdaBalance = PdaBalanceRow & {
  employee_name?: string | null;
  employee_type?: string | null;
};

/** This page's forms, in the portal's shared dialog. */
function Dialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return <Modal title={title} onClose={onClose} footer={footer}>{children}</Modal>;
}

export default function PdaManagerPage() {
  const { data: session, status } = useSession();
  const confirm = useConfirm();


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

    const role = normaliseRole(session?.user?.employee_type);
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
    if (!(await confirm({
      title: "Open this PDA account?",
      details: [["Employee", code], ["Allocation", money(Number.isFinite(form.balance) ? form.balance : 0)]],
      confirmLabel: "Open account",
    }))) return;

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
    if (!(await confirm({
      title: "Set this allocation?",
      details: [["Employee", editing.employee_id], ["New allocation", money(Number(editing.allocated))]],
      confirmLabel: "Set allocation",
    }))) return;
    setLoading(true);
    const { data, error } = await api.patch<{ account: PdaBalance }>("/api/admin/pda", {
      employee_id: editing.employee_id.trim(),
      allocated: Number(editing.allocated),
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
    if (!(await confirm({
      title: "Close this PDA account?",
      description: "A closed account cannot fund new bills. Its history is kept.",
      details: [["Employee", employeeId]],
      confirmLabel: "Close account",
      tone: "danger",
    }))) return;
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

  const [bulk, setBulk] = useState<string | null>(null);

  const handleAddAmountToAll = async () => {
    if (bulk === null) return;
    const delta = parseFloat(bulk);
    if (!Number.isFinite(delta)) {
      setNotice({ kind: "bad", text: "That is not a valid amount." });
      return;
    }
    setBulk(null);
    if (!(await confirm({
      title: "Add this amount to every PDA allocation?",
      details: [["Amount per account", money(delta)]],
      confirmLabel: "Add to all",
    }))) return;

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
    if (!(await confirm({
      title: "Reduce every allocation to what is already committed or spent?",
      description: "This leaves nothing free for new bills. Money already promised to bills in progress is not touched. This cannot be undone.",
      confirmLabel: "Reduce all",
      tone: "danger",
    }))) return;

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

  const input = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 read-only:bg-slate-50 read-only:text-slate-600";
  const th = "px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500";
  const cancelBtn = "inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50";
  const primaryBtn = "inline-flex h-9 items-center rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800";

  return (
    <AppShell desk="PDA Manager" nav={[{ label: "PDA Accounts", icon: <IconWallet />, active: true, onClick: () => undefined }]}>
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
      <PageHeader
        title="PDA Accounts"
        description="Open accounts and set allocations. Money already committed to bills or spent is never touched."
        actions={
          <>
            <ExportButton href={`/api/admin/pda?format=csv${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ""}`} />
            <button onClick={() => setIsAdding(true)} className={primaryBtn}>Open account</button>
            <button onClick={() => setBulk("")} className={cancelBtn}>Add amount to all</button>
            <button onClick={handleResetAll} className="inline-flex h-9 items-center rounded-md border border-red-300 bg-white px-4 text-sm font-medium text-red-700 hover:bg-red-50">
              Remove all free balance
            </button>
          </>
        }
      />

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <label className="relative w-full md:w-80">
            <span className="sr-only">Search</span>
            <input
              type="search"
              placeholder="Search employee, department or email"
              value={search}
              onChange={(e) => { setPage(1); setSearch(e.target.value); }}
              className={input}
            />
          </label>
          <p className="text-sm text-slate-600">Showing {start}–{end} of {total}</p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className={th}>Employee</th>
                <th scope="col" className={`${th} text-right`}>Free balance</th>
                <th scope="col" className={`${th} text-right`}>Allocated</th>
                <th scope="col" className={th}>Department</th>
                <th scope="col" className={th}>Last updated</th>
                <th scope="col" className={th}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3">
                    <p className="font-medium text-slate-900">{r.employee_name ?? r.employee_id}</p>
                    <p className="text-xs text-slate-500">{r.employee_id}{r.email ? ` · ${r.email}` : ""}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">{money(r.balance)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">
                    {money(r.allocated)}
                    {Number(r.committed) > 0 && <span className="block text-xs text-slate-500">{money(r.committed)} committed</span>}
                  </td>
                  <td className="min-w-[14rem] px-4 py-3 text-slate-700">{r.department}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{when(r.updated_at)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <button onClick={() => setEditing(r)} className="rounded-md px-2 py-1 font-medium text-blue-700 hover:bg-blue-50">Set allocation</button>
                    <button onClick={() => handleDelete(r.id)} className="ml-1 rounded-md px-2 py-1 font-medium text-red-700 hover:bg-red-50">Close account</button>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No accounts found.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 md:flex-row">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Rows per page
            <select
              value={pageSize}
              onChange={(e) => { setPage(1); setPageSize(parseInt(e.target.value, 10)); }}
              className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm"
            >
              {[5, 10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button disabled={!canPrev} onClick={() => canPrev && setPage((p) => p - 1)} className={`${cancelBtn} disabled:cursor-not-allowed disabled:opacity-50`}>Previous</button>
            <span className="text-sm text-slate-600">Page {page} of {Math.max(Math.ceil(total / pageSize), 1)}</span>
            <button disabled={!canNext} onClick={() => canNext && setPage((p) => p + 1)} className={`${cancelBtn} disabled:cursor-not-allowed disabled:opacity-50`}>Next</button>
          </div>
        </div>
      </section>

      {isAdding && (
        <Dialog title="Open a PDA account" onClose={() => setIsAdding(false)}
          footer={<><button onClick={() => setIsAdding(false)} className={cancelBtn}>Cancel</button><button onClick={handleAdd} className={primaryBtn}>Open account</button></>}>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Employee ID</span>
            <input type="text" value={form.employee_id} onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))} className={input} placeholder="e.g. E001" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Opening allocation (₹)</span>
            <input type="number" min={0} step="0.01" value={String(form.balance)} onChange={(e) => setForm((f) => ({ ...f, balance: e.target.value === "" ? 0 : parseFloat(e.target.value) }))} className={input} />
          </label>
          <p className="text-xs text-slate-500">Department and email are taken from the employee directory, so the account always matches the person.</p>
        </Dialog>
      )}

      {editing && (
        <Dialog title={`Set allocation for ${editing.employee_id}`} onClose={() => setEditing(null)}
          footer={<><button onClick={() => setEditing(null)} className={cancelBtn}>Cancel</button><button onClick={handleUpdate} className={primaryBtn}>Save allocation</button></>}>
          <dl className="grid grid-cols-3 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
            <div><dt className="text-xs text-slate-500">Free</dt><dd className="font-medium tabular-nums">{money(editing.balance)}</dd></div>
            <div><dt className="text-xs text-slate-500">Committed</dt><dd className="font-medium tabular-nums">{money(editing.committed)}</dd></div>
            <div><dt className="text-xs text-slate-500">Spent</dt><dd className="font-medium tabular-nums">{money(editing.spent)}</dd></div>
          </dl>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Total allocation (₹)</span>
            <input type="number" min={0} step="0.01" value={String(editing.allocated)} onChange={(e) => setEditing((prev) => (prev ? { ...prev, allocated: e.target.value === "" ? 0 : parseFloat(e.target.value) } : prev))} className={input} />
            <span className="mt-1 block text-xs text-slate-500">Cannot be less than committed + spent ({money(Number(editing.committed) + Number(editing.spent))}).</span>
          </label>
          <p className="text-xs text-slate-500">{editing.department}{editing.email ? ` · ${editing.email}` : ""} — managed in the employee directory.</p>
        </Dialog>
      )}

      {bulk !== null && (
        <Dialog title="Add an amount to every allocation" onClose={() => setBulk(null)}
          footer={<><button onClick={() => setBulk(null)} className={cancelBtn}>Cancel</button><button onClick={handleAddAmountToAll} className={primaryBtn}>Continue</button></>}>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Amount per account (₹)</span>
            <input type="number" min={0} step="0.01" autoFocus value={bulk} onChange={(e) => setBulk(e.target.value)} className={input} />
          </label>
        </Dialog>
      )}

      {loading && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20" role="status" aria-label="Working">
          <div className="size-10 animate-spin rounded-full border-2 border-white border-t-blue-600" />
        </div>
      )}
    </AppShell>
  );
}
