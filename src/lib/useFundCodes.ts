"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const STANDING = ["PDA", "OH-31", "OH-35"];

/**
 * Codes of every source of fund bills may be charged to, for the
 * "Source of fund" filters. The standing three are shown until the Dean's
 * approved list arrives, and if it cannot be loaded.
 */
export function useFundCodes(): string[] {
  const [codes, setCodes] = useState<string[]>(STANDING);
  useEffect(() => {
    let cancelled = false;
    api.get<{ sources: { code: string }[] }>("/api/fund-sources").then(({ data }) => {
      if (!cancelled && data?.sources?.length) setCodes(data.sources.map((s) => s.code));
    });
    return () => { cancelled = true; };
  }, []);
  return codes;
}
