"use client";

import { useState, type ReactNode } from "react";
import { IconFilter, IconSearch } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

/** Inputs used inside FilterBar's advanced section. */
export const filterInput =
  "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30";

export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

/**
 * Search box, an expandable set of filters, Clear and an optional primary
 * action, with the result count underneath. The page owns the filter state.
 */
export default function FilterBar({ search, onSearch, placeholder, onClear, active, summary, actions, children }: {
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  onClear?: () => void;
  /** Whether any filter is set, so Clear is only offered when it does something. */
  active?: boolean;
  summary?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-2 md:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Search</span>
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={placeholder}
            className={cn(filterInput, "pl-9")}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {children && (
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
              className={cn("inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium",
                open ? "border-blue-300 bg-blue-50 text-blue-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>
              <IconFilter className="size-4" aria-hidden="true" /> Filters
            </button>
          )}
          {onClear && active && (
            <button type="button" onClick={onClear}
              className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-slate-600 hover:bg-slate-100">
              Clear filters
            </button>
          )}
          {actions}
        </div>
      </div>
      {children && open && <div className="grid grid-cols-1 gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>}
      {summary && <p className="text-sm text-slate-600">{summary}</p>}
    </div>
  );
}
