"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { IconArrowDownLeft, IconArrowUpRight } from "@tabler/icons-react";
import AppShell, { sharedLinks } from "@/components/AppShell";
import Notice, { type NoticeState } from "@/components/Notice";
import FilterBar, { FilterField, filterInput } from "@/components/FilterBar";
import { EmptyState, LoadingState, PageHeader } from "@/components/ui/page";
import { api, money, qs, when } from "@/lib/api";
import { canOpenMovementRegister, deskLabel, homeFor, normaliseRole } from "@/lib/roles";
import { useLiveRefresh } from "@/lib/useLiveRefresh";

type Register = "Inward" | "Outward";
type Entry = {
  id: number; register: Register; desk: string; financial_year: string; serial_no: string;
  bill_id: string; bill_number: string | null; employee_id: string | null; employee_name: string | null;
  department: string | null; item_description: string | null; amount: number | null;
  counterpart: string; nature: string; actor_name: string | null; actor_code: string | null; remark: string | null;
  moved_at: string; seconds_at_desk: number | null;
};

const DESKS = ["Student Purchase", "Audit", "Finance Admin"] as const;
const PAGE = 50;
const th = "whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500";

function duration(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
}

/** Colour for a movement, matching the shared status palette. */
const natureTone = (nature: string) =>
  nature === "Rejected" ? "bg-red-50 text-red-800 ring-red-200"
  : nature === "On hold" ? "bg-orange-50 text-orange-800 ring-orange-200"
  : nature === "Final approval" ? "bg-green-50 text-green-800 ring-green-200"
  : nature.startsWith("Recalled") ? "bg-amber-50 text-amber-800 ring-amber-200"
  : "bg-slate-50 text-slate-700 ring-slate-200";

/**
 * The inward (diary) and outward (dispatch) registers of the bill flow:
 * where each bill came from when it reached a desk, and where it went when
 * it left. Kept by the database from the workflow log (0008).
 */
export default function MovementRegisterPage() {
  const { data: session, status } = useSession();
  const role = normaliseRole(session?.user?.employee_type);
  const allowed = status === "authenticated" && canOpenMovementRegister(role);

  const [register, setRegister] = useState<Register>("Inward");
  // Each desk opens on its own register; the Dean on every desk.
  const [desk, setDesk] = useState<string>("");
  const [deskChosen, setDeskChosen] = useState(false);
  const [fy, setFy] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [years, setYears] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState>(null);

  useEffect(() => {
    if (status === "unauthenticated") window.location.href = "/login";
    else if (status === "authenticated" && !canOpenMovementRegister(role)) window.location.replace(homeFor(role));
  }, [status, role]);

  useEffect(() => {
    if (!allowed || deskChosen) return;
    setDesk(role === "Dean" ? "" : role);
    setDeskChosen(true);
  }, [allowed, deskChosen, role]);

  const load = useCallback(async (silent = false) => {
    if (!allowed || !deskChosen) return;
    if (!silent) setLoading(true);
    const { data, error } = await api.get<{ entries: Entry[]; total: number; financialYears: string[] }>(
      "/api/movements" + qs({ register, desk, fy, q: search.trim(), limit: PAGE, offset: page * PAGE })
    );
    if (!silent) setLoading(false);
    if (error) { if (!silent) setNotice({ kind: "bad", text: error }); return; }
    setEntries(data!.entries);
    setTotal(data!.total);
    setYears(data!.financialYears);
  }, [allowed, deskChosen, register, desk, fy, search, page]);

  useEffect(() => {
    const t = setTimeout(() => load(), 250);
    return () => clearTimeout(t);
  }, [load]);
  useLiveRefresh(() => load(true));

  if (!allowed) return null;

  const inward = register === "Inward";
  const pages = Math.max(Math.ceil(total / PAGE), 1);
  const switchRegister = (r: Register) => { setRegister(r); setPage(0); };

  return (
    <AppShell
      desk="Inward / Outward Register"
      nav={[
        { label: "Inward Register", icon: <IconArrowDownLeft />, onClick: () => switchRegister("Inward"), active: inward },
        { label: "Outward Register", icon: <IconArrowUpRight />, onClick: () => switchRegister("Outward"), active: !inward },
      ]}
      links={sharedLinks(role, "movements")}
    >
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
      <PageHeader
        title={inward ? "Inward Register" : "Outward Register"}
        description={inward
          ? "Every bill received at a desk, and where it came from."
          : "Every bill sent on from a desk, where it went, and how long it stayed."}
      />

      <FilterBar
        search={search}
        onSearch={(v) => { setSearch(v); setPage(0); }}
        placeholder="Search by serial, bill number, employee, item or desk"
        onClear={() => { setSearch(""); setFy(""); setDesk(role === "Dean" ? "" : role); setPage(0); }}
        active={Boolean(search || fy || desk !== (role === "Dean" ? "" : role))}
        summary={`${total.toLocaleString("en-IN")} ${inward ? "inward" : "outward"} entries${desk ? ` at ${deskLabel(desk)}` : " across all desks"}, newest first`}
        actions={
          <select aria-label="Desk" value={desk} onChange={(e) => { setDesk(e.target.value); setPage(0); }} className={`${filterInput} md:w-56`}>
            <option value="">All desks</option>
            {DESKS.map((d) => <option key={d} value={d}>{deskLabel(d)}</option>)}
          </select>
        }
      >
        <FilterField label="Financial year">
          <select value={fy} onChange={(e) => { setFy(e.target.value); setPage(0); }} className={filterInput}>
            <option value="">All years</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </FilterField>
      </FilterBar>

      {loading && entries.length === 0 ? <LoadingState label="Loading the register…" /> : entries.length === 0 ? (
        <EmptyState title="No entries" description={search || fy ? "Try adjusting your search or filters." : "Entries appear as bills move between desks."} />
      ) : (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>{inward ? "Inward no. / received" : "Outward no. / dispatched"}</th>
                  <th className={th}>Bill</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={th}>{inward ? "From" : "To"}</th>
                  <th className={th}>Movement</th>
                  {!inward && <th className={th}>At desk</th>}
                  <th className={th}>Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((e) => (
                  <tr key={e.id} className="align-top hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3">
                      <p className="font-mono text-xs text-slate-800">{e.serial_no}</p>
                      <p className="text-xs text-slate-500">{when(e.moved_at)}</p>
                      {!desk && <p className="mt-1 text-xs font-medium text-slate-600">{deskLabel(e.desk)}</p>}
                    </td>
                    <td className="min-w-[14rem] max-w-xs px-4 py-3">
                      <Link href={`/bill/${e.bill_id}`} className="whitespace-nowrap font-mono text-xs font-medium text-blue-700 hover:underline">{e.bill_number ?? "—"}</Link>
                      <p className="truncate text-slate-800" title={e.item_description ?? ""}>{e.item_description || "—"}</p>
                      <p className="truncate text-xs text-slate-500" title={e.department ?? ""}>{e.employee_name} ({e.employee_id})</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(e.amount)}</td>
                    <td className="min-w-[11rem] max-w-[16rem] px-4 py-3 text-slate-900">{e.counterpart}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${natureTone(e.nature)}`}>{e.nature}</span>
                      <p className="mt-1 whitespace-nowrap text-xs text-slate-500">by {e.actor_name ?? e.actor_code ?? "—"}</p>
                    </td>
                    {!inward && <td className="whitespace-nowrap px-4 py-3 text-slate-600">{duration(e.seconds_at_desk)}</td>}
                    <td className="min-w-[12rem] max-w-sm px-4 py-3 text-slate-700">{e.remark || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
            <span>Page {page + 1} of {pages}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage((n) => Math.max(n - 1, 0))} disabled={page === 0} className="h-8 rounded-md border border-slate-300 bg-white px-3 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Previous</button>
              <button onClick={() => setPage((n) => Math.min(n + 1, pages - 1))} disabled={page >= pages - 1} className="h-8 rounded-md border border-slate-300 bg-white px-3 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Next</button>
            </div>
          </div>
        </section>
      )}
      <p className="text-center text-xs text-slate-400">Register entries are permanent. They are written automatically as bills move and cannot be edited or deleted.</p>
    </AppShell>
  );
}
