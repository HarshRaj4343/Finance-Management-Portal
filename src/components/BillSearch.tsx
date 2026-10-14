"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconSearch } from "@tabler/icons-react";
import { api, money } from "@/lib/api";
import { StatusBadge } from "./ui/page";
import type { Bill } from "@/types/database";

type Hit = Pick<Bill, "id" | "bill_number" | "item_description" | "employee_name" | "employee_id" | "status" | "po_value" | "invoice_no">;

/**
 * Find a bill from any page: by bill number, invoice number, supplier,
 * applicant or item. Results come from /api/bills, so each role only ever
 * finds the bills it may open. Ctrl/⌘+K focuses it.
 */
export default function BillSearch() {
  const router = useRouter();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); input.current?.focus(); input.current?.select(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); setLoading(false); return; }
    setLoading(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await api.get<{ bills: Hit[] }>(`/api/bills?limit=8&q=${encodeURIComponent(term)}`);
      if (cancelled) return;
      setHits(data?.bills ?? []);
      setActive(-1);
      setLoading(false);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  const go = (hit: Hit) => { setOpen(false); setQ(""); router.push(`/bill/${hit.id}`); };
  const showList = open && q.trim().length >= 2;

  return (
    <div className="relative w-full max-w-xl">
      <label htmlFor={`${listId}-input`} className="sr-only">Search bills</label>
      <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
      <input
        ref={input}
        id={`${listId}-input`}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, hits.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter" && hits.length) { e.preventDefault(); go(hits[Math.max(active, 0)]); }
          else if (e.key === "Escape") { setOpen(false); (e.target as HTMLInputElement).blur(); }
        }}
        placeholder="Search bill no., invoice, supplier or applicant"
        className="h-9 w-full rounded-md border border-slate-300 bg-white pl-9 pr-14 text-sm placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
      />
      {!q && (
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-slate-300 bg-slate-50 px-1.5 text-[10px] font-medium text-slate-500 sm:block" aria-hidden="true">
          Ctrl K
        </kbd>
      )}
      {showList && (
        <ul id={listId} role="listbox" aria-label="Matching bills"
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-96 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {loading && hits.length === 0 && <li className="px-3 py-2 text-sm text-slate-500" role="presentation">Searching…</li>}
          {!loading && hits.length === 0 && <li className="px-3 py-2 text-sm text-slate-500" role="presentation">No bill matches “{q.trim()}”.</li>}
          {hits.map((hit, i) => (
            <li
              key={hit.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); go(hit); }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 ${i === active ? "bg-blue-50" : "hover:bg-slate-50"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-medium text-blue-800">{hit.bill_number ?? "—"}</span>
                <StatusBadge value={hit.status} />
              </div>
              <p className="truncate text-sm text-slate-900">{hit.item_description || "No description"}</p>
              <p className="truncate text-xs text-slate-600">
                {hit.employee_name} ({hit.employee_id}) · {money(hit.po_value)}{hit.invoice_no ? ` · Invoice ${hit.invoice_no}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
