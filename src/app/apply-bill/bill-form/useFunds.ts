"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { FUNDS, type Fund } from "./masters";

type SourceRow = { code: string; description: string; group_name: string; categories: string[] };

/** How a source row from /api/fund-sources is shown in the form. */
export const toFund = (s: SourceRow): Fund => ({ code: s.code, description: s.description, group: s.group_name, categories: s.categories });

/**
 * The sources of fund the Dean's office has approved, for the form's
 * dropdown. `loaded` stays false until the list arrives (or the request
 * fails, when the three standing sources are offered and the database
 * remains the judge).
 */
export function useFunds(): { funds: Fund[]; loaded: boolean } {
  const [state, setState] = useState<{ funds: Fund[]; loaded: boolean }>({ funds: FUNDS, loaded: false });
  useEffect(() => {
    let cancelled = false;
    api.get<{ sources: SourceRow[] }>("/api/fund-sources").then(({ data }) => {
      if (cancelled) return;
      setState(data?.sources?.length ? { funds: data.sources.map(toFund), loaded: true } : { funds: FUNDS, loaded: false });
    });
    return () => { cancelled = true; };
  }, []);
  return state;
}
