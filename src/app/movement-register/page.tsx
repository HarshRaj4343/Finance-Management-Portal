"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { IconArrowDownLeft, IconArrowUpRight } from "@tabler/icons-react";
import AppShell, { sharedLinks } from "@/components/AppShell";
import Notice, { type NoticeState } from "@/components/Notice";
import FilterBar, { FilterField, filterInput } from "@/components/FilterBar";
import { EmptyState, ExportButton, LoadingState, PageHeader } from "@/components/ui/page";
import { api, money, qs, when, count } from "@/lib/api";
import { canOpenMovementRegister, deskLabel, homeFor, normaliseRole } from "@/lib/roles";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { Kbd, ShortcutHelp, type ShortcutList } from "@/components/DeskShortcuts";

type Register = "Inward" | "Outward";
type Entry = {
  id: number; register: Register; desk: string; financial_year: string; serial_no: string;
  bill_id: string; bill_number: string | null; employee_id: string | null; employee_name: string | null;
  department: string | null; item_description: string | null; amount: number | null;
  counterpart: string; nature: string; actor_name: string | null; actor_code: string | null; remark: string | null;
  moved_at: string; seconds_at_desk: number | null;
  received: boolean; received_by: string | null; received_marked_at: string | null;
};

const DESKS = ["Student Purchase", "Audit", "Finance Admin"] as const;

const REGISTER_SHORTCUTS: ShortcutList = [
  [["J", "↓"], "Next entry"],
  [["K", "↑"], "Previous entry"],
  [["R"], "Mark the selected entry Received"],
  [["N"], "Mark the selected entry Not received"],
  [["X", "Space"], "Switch the selected entry between Received and Not received"],
  [["⇧ J", "⇧ K"], "Mark Received while moving down / up"],
  [["O", "Enter"], "Open the bill in a new tab"],
  [["←", "→"], "Previous / next page"],
  [["[", "]"], "Inward / Outward register"],
  [["/"], "Search"],
  [["?"], "Show this list"],
];
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

  // Received / Not received. Shown at once, put back if the server refuses.
  const [marking, setMarking] = useState<Set<number>>(new Set());
  const canMark = (e: Entry) => role === "Dean" || role === e.desk;
  const markReceived = async (e: Entry, received: boolean) => {
    const flip = (value: boolean) => setEntries((list) => list.map((x) => (x.id === e.id ? { ...x, received: value } : x)));
    flip(received);
    setMarking((s) => new Set(s).add(e.id));
    const { error } = await api.post(`/api/movements/${e.id}/receipt`, { received });
    setMarking((s) => { const n = new Set(s); n.delete(e.id); return n; });
    if (error) { flip(!received); setNotice({ kind: "bad", text: error }); return; }
    load(true);
  };

  // Keyboard: move with J / K, mark with X or Space, ? for the list.
  const [selected, setSelected] = useState<number | null>(null);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    if (!entries.length) { setSelected(null); return; }
    if (!entries.some((e) => e.id === selected)) setSelected(entries[0].id);
  }, [entries, selected]);
  useEffect(() => {
    if (!allowed) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const target = ev.target as HTMLElement;
      if (target.closest("input:not([type='checkbox']), textarea, select, [contenteditable='true']")) {
        if (ev.key === "Escape" && target.matches("input[type='search']")) { ev.preventDefault(); target.blur(); }
        return;
      }
      const at = entries.findIndex((e) => e.id === selected);
      const here = at >= 0 ? entries[at] : null;
      const go = (step: number) => {
        if (!entries.length) return;
        ev.preventDefault();
        const next = entries[Math.max(0, Math.min(entries.length - 1, at + step))];
        // Shift marks as it moves: the entry left and the entry reached.
        if (ev.shiftKey) for (const e of [here, next]) if (e && !e.received && canMark(e) && !marking.has(e.id)) markReceived(e, true);
        setSelected(next.id);
        document.querySelector(`[data-entry="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
      };
      switch (ev.key) {
        case "j": case "J": case "ArrowDown": return go(1);
        case "k": case "K": case "ArrowUp": return go(-1);
        case "x": case "X": case " ": case "r": case "R": case "n": case "N": {
          if (!here) return;
          // A focused checkbox toggles itself on Space; only take over elsewhere.
          if (ev.key === " " && target.closest("button, a, input")) return;
          ev.preventDefault();
          if (!canMark(here)) { setNotice({ kind: "info", text: `Only ${deskLabel(here.desk)} or the Dean can mark this entry.` }); return; }
          // R and N set the mark outright, so pressing either twice is harmless; X and Space switch it.
          const key = ev.key.toLowerCase();
          const received = key === "r" ? true : key === "n" ? false : !here.received;
          if (received !== here.received && !marking.has(here.id)) markReceived(here, received);
          return;
        }
        case "o": case "O": case "Enter":
          if (!here || (ev.key === "Enter" && target.closest("button, a, input"))) return;
          ev.preventDefault();
          window.open(`/bill/${here.bill_id}`, "_blank", "noopener");
          return;
        case "ArrowLeft": case "ArrowRight": {
          ev.preventDefault();
          const last = Math.max(Math.ceil(total / PAGE), 1) - 1;
          setPage((n) => Math.max(0, Math.min(last, n + (ev.key === "ArrowRight" ? 1 : -1))));
          return;
        }
        case "[": case "]":
          ev.preventDefault();
          setRegister(ev.key === "[" ? "Inward" : "Outward"); setPage(0);
          return;
        case "/": {
          const box = document.querySelector<HTMLInputElement>("input[type='search']");
          if (!box) return;
          ev.preventDefault(); box.focus(); box.select();
          return;
        }
        case "?":
          ev.preventDefault(); setHelp(true);
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
        actions={<ExportButton endpoint="/api/movements" title="Inward / Outward Register"
          values={{ register, desk, fy, q: search.trim() }}
          filters={[
            { key: "register", label: "Register", type: "select", changesColumns: true, options: [
              { value: "Inward", label: "Inward register" }, { value: "Outward", label: "Outward register" }] },
            { key: "desk", label: "Desk", type: "select", any: "All desks", options: DESKS.map((d) => ({ value: d, label: deskLabel(d) })) },
            { key: "department", label: "School / department", type: "department" },
            { key: "received", label: "Receipt", type: "select", options: [
              { value: "yes", label: "Received" }, { value: "no", label: "Not received" }] },
            { key: "fy", label: "Financial year", type: "select", options: years, any: "All years" },
            { key: "q", label: "Search", type: "text", placeholder: "Serial, bill no., employee, item" },
            { key: "from", label: "Moved from", type: "date" },
            { key: "to", label: "Moved to", type: "date" },
          ]} />}
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
        summary={`${count(total)} ${inward ? "inward" : "outward"} entries${desk ? ` at ${deskLabel(desk)}` : " across all desks"}, newest first`}
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
                  <th scope="col" className={th}>Receipt</th>
                  <th scope="col" className={th}>{inward ? "Inward no. / received" : "Outward no. / dispatched"}</th>
                  <th scope="col" className={th}>Bill</th>
                  <th scope="col" className={`${th} text-right`}>Amount</th>
                  <th scope="col" className={th}>{inward ? "From" : "To"}</th>
                  <th scope="col" className={th}>Movement</th>
                  {!inward && <th scope="col" className={th}>At desk</th>}
                  <th scope="col" className={th}>Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((e) => (
                  <tr key={e.id} data-entry={e.id} onMouseDown={() => setSelected(e.id)}
                    className={`align-top hover:bg-slate-50 ${selected === e.id ? "bg-blue-50/60 outline outline-2 -outline-offset-2 outline-blue-500" : ""}`}>
                    <td className="whitespace-nowrap px-4 py-3">
                      <label
                        className={`inline-flex items-center gap-2 text-xs font-medium ${canMark(e) ? "cursor-pointer" : "cursor-not-allowed opacity-70"} ${e.received ? "text-green-800" : "text-slate-600"}`}
                        title={canMark(e)
                          ? (e.received_by ? `Marked by ${e.received_by}, ${when(e.received_marked_at)}` : "Press Space or click to mark received")
                          : `Only ${deskLabel(e.desk)} or the Dean can mark this entry`}
                      >
                        <input
                          type="checkbox"
                          checked={e.received}
                          disabled={!canMark(e) || marking.has(e.id)}
                          onChange={(ev) => markReceived(e, ev.target.checked)}
                          aria-label={`${e.serial_no}: ${e.received ? "Received" : "Not received"}`}
                          className="size-4 rounded border-slate-300 accent-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
                        />
                        {e.received ? "Received" : "Not received"}
                      </label>
                    </td>
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
      <p className="hidden flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-slate-500 md:flex">
        <span className="font-medium text-slate-600">Keyboard:</span>
        <span><Kbd>J</Kbd> <Kbd>K</Kbd> move</span>
        <span><Kbd>R</Kbd> received</span>
        <span><Kbd>N</Kbd> not received</span>
        <span><Kbd>X</Kbd> or <Kbd>Space</Kbd> switch</span>
        <span><Kbd>⇧ J</Kbd> mark while moving</span>
        <span><Kbd>?</Kbd> all shortcuts</span>
      </p>
      <ShortcutHelp open={help} onClose={() => setHelp(false)} list={REGISTER_SHORTCUTS}
        intro="Go through the register without the mouse. You can mark only your own desk's entries (the Dean, any)." />
      <p className="text-center text-xs text-slate-500">Register entries are permanent. They are written automatically as bills move and cannot be edited or deleted.</p>
    </AppShell>
  );
}
