"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, money } from "@/lib/api";
import { deskLabel, routeAfter, type Stage } from "@/lib/roles";
import { BULK_LARGE_BILL, BULK_MAX_BILLS, BULK_MAX_TOTAL, BULK_UNDO_MS } from "@/lib/bulk";
import type { Bill } from "@/types/database";
import type { NoticeState } from "./Notice";
import { useConfirm } from "./ConfirmProvider";
import { Kbd, type BulkKeys } from "./DeskShortcuts";

type Outcome = { id: string; bill_number: string | null; ok: boolean; error?: string; bill?: Bill };
type Pending = { bills: Bill[]; total: number; until: number };

const amount = (b: Bill) => Number(b.po_value ?? 0);
const sum = (bills: Bill[]) => bills.reduce((t, b) => t + amount(b), 0);

/** "3 (₹1,20,000)" lines grouped by a key, largest group first. */
function grouped(bills: Bill[], key: (b: Bill) => string): string {
  const groups = new Map<string, Bill[]>();
  for (const b of bills) groups.set(key(b), [...(groups.get(key(b)) ?? []), b]);
  return [...groups].sort((a, b) => b[1].length - a[1].length)
    .map(([name, list]) => `${name}: ${list.length} (${money(sum(list))})`).join(" · ");
}

/**
 * Bulk approval at a desk: tick bills, see one summary, confirm once, and
 * an Undo countdown before anything is sent. The server
 * (api/bills/bulk-action) approves each bill on its own with the usual
 * checks, and enforces the same limits as src/lib/bulk.ts.
 */
export function useBulkApproval({ desk, shown, canDecide, replace, notify }: {
  desk: Stage;
  /** Bills on screen, in order. */
  shown: Bill[];
  canDecide: (bill: Bill) => boolean;
  replace: (bill: Bill) => void;
  notify: (notice: NoticeState) => void;
}) {
  const confirm = useConfirm();
  const [ticked, setTickedState] = useState<Set<string>>(new Set());
  // Read synchronously: one key press can tick two bills (Shift + J).
  const tickedRef = useRef(ticked);
  const setTicked = (next: Set<string> | ((t: Set<string>) => Set<string>)) => {
    const value = typeof next === "function" ? next(tickedRef.current) : next;
    tickedRef.current = value;
    setTickedState(value);
  };
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const eligible = (b: Bill) => canDecide(b) && amount(b) <= BULK_LARGE_BILL;
  const selected = useMemo(() => shown.filter((b) => ticked.has(b.id)), [shown, ticked]);
  const total = sum(selected);

  // Ticks follow the list: a bill that leaves it (decided, filtered out) is unticked.
  useEffect(() => {
    setTicked((t) => {
      const keep = new Set([...t].filter((id) => shown.some((b) => b.id === id && eligible(b))));
      return keep.size === t.size ? t : keep;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  // Nothing is sent if the page goes away during the countdown.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [pending]);

  /** Why this bill cannot join the batch, or null. */
  const refusal = (b: Bill, count: number, money_: number): string | null => {
    if (!canDecide(b)) return "You cannot decide this bill here.";
    if (amount(b) > BULK_LARGE_BILL) return `${b.bill_number ?? "This bill"} is above ${money(BULK_LARGE_BILL)}: approve it on its own.`;
    if (count + 1 > BULK_MAX_BILLS) return `A batch holds at most ${BULK_MAX_BILLS} bills.`;
    if (money_ + amount(b) > BULK_MAX_TOTAL) return `A batch holds at most ${money(BULK_MAX_TOTAL)}.`;
    return null;
  };

  const add = (id: string, quiet = false) => {
    const now_ = tickedRef.current;
    if (pending || busy || now_.has(id)) return;
    const b = shown.find((x) => x.id === id);
    if (!b) return;
    const why = refusal(b, now_.size, sum(shown.filter((x) => now_.has(x.id))));
    if (why) { if (!quiet) notify({ kind: "info", text: why }); return; }
    setTicked((t) => new Set(t).add(id));
  };
  const toggle = (id: string) => {
    if (tickedRef.current.has(id)) setTicked((t) => { const n = new Set(t); n.delete(id); return n; });
    else add(id);
  };
  const selectAll = () => {
    if (pending || busy) return;
    const next = new Set(tickedRef.current);
    let money_ = sum(shown.filter((x) => next.has(x.id))), stopped: string | null = null, skipped = 0;
    for (const b of shown) {
      if (next.has(b.id)) continue;
      if (!canDecide(b) || amount(b) > BULK_LARGE_BILL) { skipped++; continue; }
      const why = refusal(b, next.size, money_);
      if (why) { stopped = why; break; }
      next.add(b.id); money_ += amount(b);
    }
    setTicked(next);
    notify({ kind: "info", text: `${next.size} bills ticked (${money(money_)}).`
      + (stopped ? ` Stopped at the batch limit: ${stopped}` : "")
      + (skipped ? ` ${skipped} left out: above ${money(BULK_LARGE_BILL)} or not yours to decide.` : "") });
  };
  const clear = () => { if (!pending && !busy) setTicked(new Set()); };

  async function send(bills: Bill[]) {
    setBusy(true);
    const { data, error } = await api.post<{ approved: number; failed: number; total: number; outcomes: Outcome[] }>(
      "/api/bills/bulk-action", { bills: bills.map((b) => ({ id: b.id, expected_revision: b.revision })) });
    setBusy(false);
    if (error || !data) { notify({ kind: "bad", text: error ?? "Could not record those decisions." }); return; }
    for (const o of data.outcomes) if (o.ok && o.bill) replace(o.bill);
    const failed = data.outcomes.filter((o) => !o.ok);
    // Failed bills stay ticked for a second look.
    setTicked(new Set(failed.map((o) => o.id)));
    const head = `${data.approved} ${data.approved === 1 ? "bill" : "bills"} approved (${money(data.total)}).`;
    notify(failed.length
      ? { kind: "bad", text: `${head} ${failed.length} not approved, still ticked: ${failed.slice(0, 5)
          .map((o) => `${o.bill_number ?? "bill"} (${o.error})`).join("; ")}${failed.length > 5 ? `; and ${failed.length - 5} more` : ""}.` }
      : { kind: "ok", text: head });
  }

  const approve = async () => {
    if (pending || busy || selected.length === 0) return;
    const bills = selected;
    const largest = bills.reduce((a, b) => (amount(b) > amount(a) ? b : a));
    const finalDesk = desk === "Finance Admin";
    const ok = await confirm({
      title: `Approve ${bills.length} ${bills.length === 1 ? "bill" : "bills"} totalling ${money(sum(bills))}?`,
      description: finalDesk
        ? "This is the final approval for each bill: its money is spent and it is entered in the purchase register. Each bill is approved and recorded separately."
        : "Each bill is approved and recorded separately and moves on to its next desk.",
      details: [
        ["Bills", `${bills.length} (limit ${BULK_MAX_BILLS})`],
        ["Total", `${money(sum(bills))} (limit ${money(BULK_MAX_TOTAL)})`],
        ["Goes to", finalDesk ? "Purchase register (final approval)"
          : grouped(bills, (b) => deskLabel(routeAfter(desk as "Student Purchase" | "Audit", b.item_category, amount(b))))],
        ["By fund", grouped(bills, (b) => b.funding_pool ?? b.source_of_fund ?? "PDA")],
        ["Largest", `${largest.bill_number ?? "—"} · ${money(amount(largest))} · ${largest.supplier_name ?? "—"}`],
        ...(desk === "Student Purchase" ? [["Bank guarantee", "None. Approve a bill that needs one on its own."] as [string, ReactNode]] : []),
        ["Undo", `You have ${BULK_UNDO_MS / 1000} seconds to undo (U) before anything is sent.`],
      ],
      confirmLabel: `Yes, approve ${bills.length}`,
    });
    if (!ok) return;
    const until = Date.now() + BULK_UNDO_MS;
    setNow(Date.now());
    setPending({ bills, total: sum(bills), until });
    timer.current = setTimeout(() => { timer.current = null; setPending(null); send(bills); }, BULK_UNDO_MS);
  };

  const undo = () => {
    if (!pending) return false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPending(null);
    notify({ kind: "info", text: "Bulk approval undone. Nothing was sent; the bills are still ticked." });
    return true;
  };

  const keys: BulkKeys = { count: ticked.size, toggle, add: (id) => add(id, true), selectAll, clear, approve, undo };

  /** The tick box at the top of a card. */
  const tickBox = (bill: Bill): ReactNode => {
    if (!canDecide(bill)) return null;
    if (amount(bill) > BULK_LARGE_BILL) {
      return <p className="mb-2 text-xs text-slate-500">Above {money(BULK_LARGE_BILL)}: approve this bill on its own.</p>;
    }
    return (
      <label className="mb-2 flex w-fit cursor-pointer items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={ticked.has(bill.id)} disabled={Boolean(pending) || busy} onChange={() => toggle(bill.id)}
          className="size-4 rounded border-slate-300 accent-blue-700" />
        Select for bulk approval
      </label>
    );
  };

  const overLimit = ticked.size > BULK_MAX_BILLS || total > BULK_MAX_TOTAL;
  const bar: ReactNode = pending ? (
    <div role="status" className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit max-w-[calc(100%-2rem)] flex-wrap items-center gap-3 rounded-lg bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">
      <span>Approving <strong>{pending.bills.length}</strong> bills ({money(pending.total)}) in{" "}
        <strong className="tabular-nums">{Math.max(0, Math.ceil((pending.until - now) / 1000))}s</strong>…</span>
      <button type="button" onClick={undo} className="rounded-md bg-white px-3 py-1 font-medium text-slate-900 hover:bg-slate-100">
        Undo <span className="text-slate-500">(U)</span>
      </button>
    </div>
  ) : ticked.size > 0 || busy ? (
    <div className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit max-w-[calc(100%-2rem)] flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-lg">
      <span className="font-medium text-slate-900">
        {busy ? "Recording approvals…" : <>{ticked.size} selected · {money(total)}</>}
      </span>
      <span className="text-xs text-slate-500">limit {BULK_MAX_BILLS} bills · {money(BULK_MAX_TOTAL)}</span>
      <button type="button" onClick={approve} disabled={busy || overLimit}
        className="inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-4 font-medium text-white hover:bg-green-700 disabled:opacity-50">
        Approve selected <Kbd>A</Kbd>
      </button>
      <button type="button" onClick={clear} disabled={busy} className="inline-flex h-9 items-center gap-2 rounded-md px-3 font-medium text-slate-700 hover:bg-slate-100">
        Clear <Kbd>Esc</Kbd>
      </button>
    </div>
  ) : null;

  return { keys, tickBox, bar, active: ticked.size > 0 || Boolean(pending) || busy };
}
