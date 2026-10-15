"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FilterField, filterInput } from "./FilterBar";
import { api, qs } from "@/lib/api";
import { cn } from "@/lib/utils";

/** One filter in the download dialog; `key` is the export endpoint's query parameter. */
export type ExportFilter =
  | { key: string; label: string; type: "select"; options: (string | { value: string; label: string })[]; any?: string; changesColumns?: boolean }
  | { key: string; label: string; type: "department" }
  | { key: string; label: string; type: "date" | "number" | "text"; placeholder?: string };

type Values = Record<string, string>;

/** Option lists several exports share. */
export const CATEGORY_OPTIONS = ["Major", "Minor", "Consumables"];
export const FUND_OPTIONS = ["PDA", "OH-31", "OH-35"];

const button = "inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50";

// Departments change rarely; one request per page load serves every dialog.
let departments: Promise<string[]> | null = null;
const loadDepartments = () => (departments ??= api.get<{ departments: { name: string }[] }>("/api/departments")
  .then((r) => {
    if (!r.data) { departments = null; return []; } // try again next time
    return r.data.departments.map((d) => d.name);
  }));

/**
 * "Download Excel (CSV)" that first asks what to download: which rows
 * (the filters, starting from what the page shows now) and which columns.
 * The server applies both (src/server/csv.ts pickColumns), so the file holds
 * exactly what was chosen.
 */
export default function ExportButton({ endpoint, title, filters, values, fixed = {}, label = "Download Excel (CSV)" }: {
  /** The list endpoint that answers ?format=csv and ?format=columns. */
  endpoint: string;
  /** What is being downloaded, e.g. "Purchase Register". */
  title: string;
  filters: ExportFilter[];
  /** The page's current filters, used as the starting point. */
  values?: Values;
  /** Parameters always sent and not offered as filters, e.g. the fund head code. */
  fixed?: Values;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Values>({});
  const [columns, setColumns] = useState<string[] | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [depts, setDepts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    setChosen(Object.fromEntries(filters.map((f) => [f.key, values?.[f.key] ?? ""])));
    setOff(new Set());
    setError(null);
    setOpen(true);
  };

  // Some exports offer different columns by filter (e.g. inward vs outward).
  const columnKeys = filters.filter((f) => f.type === "select" && f.changesColumns).map((f) => f.key);
  const columnQuery = qs({ ...fixed, ...Object.fromEntries(columnKeys.map((k) => [k, chosen[k]])), format: "columns" });
  useEffect(() => {
    if (!open) return;
    let live = true;
    setColumns(null);
    api.get<{ columns: string[] }>(endpoint + columnQuery).then(({ data, error: e }) => {
      if (!live) return;
      if (e) setError(e);
      setColumns(data?.columns ?? []);
    });
    return () => { live = false; };
  }, [open, endpoint, columnQuery]);

  // Pages pass a fresh `filters` array on every render; depend on the answer, not the array.
  const needsDepartments = filters.some((f) => f.type === "department");
  useEffect(() => {
    if (open && needsDepartments) loadDepartments().then(setDepts);
  }, [open, needsDepartments]);

  const picked = (columns ?? []).filter((c) => !off.has(c));
  const set = (key: string, value: string) => setChosen((v) => ({ ...v, [key]: value }));
  const toggle = (column: string) => setOff((s) => {
    const n = new Set(s);
    if (n.has(column)) n.delete(column); else n.add(column);
    return n;
  });

  const download = async () => {
    if (chosen.from && chosen.to && chosen.from > chosen.to) { setError("The start date is after the end date."); return; }
    if (!picked.length) { setError("Choose at least one column."); return; }
    setBusy(true);
    setError(null);
    const params = new URLSearchParams(qs({ ...fixed, ...chosen, format: "csv" }).slice(1));
    // Every column ticked: ask for the whole file, which also keeps it complete if columns are added later.
    if (picked.length < (columns?.length ?? 0)) for (const c of picked) params.append("col", c);
    try {
      const res = await fetch(`${endpoint}?${params}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? (res.status === 401 ? "Your session has expired. Please sign in again." : `The server returned ${res.status}.`));
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "export.csv";
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const active = filters.filter((f) => chosen[f.key]).length;

  return (
    <>
      <button type="button" onClick={start}
        className={cn(button, "border border-slate-300 bg-white px-3 text-slate-700 hover:bg-slate-50")}>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
        </svg>
        {label}
      </button>

      <Dialog open={open} onOpenChange={(o) => { if (!busy) setOpen(o); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogTitle>Download {title}</DialogTitle>
          <DialogDescription>
            Choose the rows and columns to include. Filters start from what the page shows now.
          </DialogDescription>

          <section aria-labelledby="export-rows" className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 id="export-rows" className="text-sm font-semibold text-slate-900">Rows</h3>
              {active > 0 && (
                <button type="button" onClick={() => setChosen(Object.fromEntries(filters.map((f) => [f.key, ""])))}
                  className="text-sm font-medium text-blue-700 hover:underline">Clear filters</button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {filters.map((f) => (
                <FilterField key={f.key} label={f.label}>
                  {f.type === "select" ? (
                    <select className={filterInput} value={chosen[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}>
                      {f.any !== undefined || !f.changesColumns ? <option value="">{f.any ?? "All"}</option> : null}
                      {f.options.map((o) => typeof o === "string"
                        ? <option key={o} value={o}>{o}</option>
                        : <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : f.type === "department" ? (
                    <select className={filterInput} value={chosen[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}>
                      <option value="">All schools and departments</option>
                      {chosen[f.key] && !depts.includes(chosen[f.key]) && <option value={chosen[f.key]}>{chosen[f.key]}</option>}
                      {depts.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  ) : (
                    <input className={filterInput} type={f.type} value={chosen[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}
                      placeholder={f.type === "text" || f.type === "number" ? f.placeholder : undefined}
                      min={f.type === "number" ? 0 : undefined} />
                  )}
                </FilterField>
              ))}
            </div>
          </section>

          <section aria-labelledby="export-columns" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="export-columns" className="text-sm font-semibold text-slate-900">
                Columns {columns && <span className="font-normal text-slate-500">({picked.length} of {columns.length})</span>}
              </h3>
              <div className="flex gap-3 text-sm font-medium">
                <button type="button" onClick={() => setOff(new Set())} className="text-blue-700 hover:underline">Select all</button>
                <button type="button" onClick={() => setOff(new Set(columns ?? []))} className="text-blue-700 hover:underline">Clear all</button>
              </div>
            </div>
            {columns === null ? (
              <p className="text-sm text-slate-500">Loading columns…</p>
            ) : (
              <div className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2 md:grid-cols-3">
                {columns.map((c) => (
                  <label key={c} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={!off.has(c)} onChange={() => toggle(c)}
                      className="size-4 rounded border-slate-300 accent-blue-700" />
                    {c}
                  </label>
                ))}
              </div>
            )}
          </section>

          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} disabled={busy}
              className={cn(button, "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>Cancel</button>
            <button type="button" onClick={download} disabled={busy || !columns || !picked.length}
              className={cn(button, "bg-blue-700 text-white hover:bg-blue-800")}>
              {busy ? "Preparing…" : "Download CSV"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
