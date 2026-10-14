"use client";

import { useEffect, useRef } from "react";

/**
 * Re-run `refresh` quietly every `ms` and whenever the tab comes back into
 * view, so a desk sees newly arrived bills (e.g. once a filer's edit window
 * closes) without reloading the page.
 */
export function useLiveRefresh(refresh: () => void, ms = 30_000) {
  const latest = useRef(refresh);
  useEffect(() => { latest.current = refresh; }, [refresh]);
  useEffect(() => {
    const run = () => { if (document.visibilityState === "visible") latest.current(); };
    const timer = setInterval(run, ms);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", run);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", run);
    };
  }, [ms]);
}
