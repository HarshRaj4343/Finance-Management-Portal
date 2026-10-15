"use client";

import { useEffect, useRef, useState } from "react";
import type { Bill } from "@/types/database";
import { api } from "./api";

/** Renew well inside fn_edit_pause_lease (3 minutes), so one missed renewal does no harm. */
const RENEW_MS = 60_000;

// Requests for one bill go out in order, so closing and quickly reopening
// the form cannot land a resume after the new pause.
const queues = new Map<string, Promise<unknown>>();
function send(id: string, pause: boolean) {
  const next = (queues.get(id) ?? Promise.resolve()).then(() =>
    api.post<{ bill: Bill }>(`/api/bills/${id}/edit-window`, { pause }));
  queues.set(id, next);
  return next;
}

/**
 * Stops a bill's edit window for as long as the correction form using this
 * hook is open, and restarts it on close (0009_edit_pause_and_receipts.sql).
 * A bill may be paused for 30 minutes in all; after that the clock runs
 * even with the form open.
 *
 * Returns the bill as the server last reported it (null until the first
 * pause answers) and a clock ticking every second for countdowns.
 * `onResumed` receives the bill once the clock is running again. If the
 * page is closed, the clock restarts by beacon; failing that, when the
 * server's pause lease runs out.
 */
export function useEditWindowPause(billId: string | null, enabled: boolean, onResumed?: (bill: Bill) => void) {
  const [bill, setBill] = useState<Bill | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const resumed = useRef(onResumed);
  useEffect(() => { resumed.current = onResumed; }, [onResumed]);

  useEffect(() => {
    if (!billId || !enabled) return;
    let live = true;
    const url = `/api/bills/${billId}/edit-window`;
    const pause = () => send(billId, true).then((r) => { if (live && r.data) setBill(r.data.bill); });
    const onHide = () => navigator.sendBeacon(url, JSON.stringify({ pause: false }));
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) pause(); };

    pause();
    const renew = setInterval(pause, RENEW_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("pageshow", onShow);
    return () => {
      live = false;
      clearInterval(renew);
      clearInterval(tick);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("pageshow", onShow);
      setBill(null);
      send(billId, false).then((r) => { if (r.data) resumed.current?.(r.data.bill); });
    };
  }, [billId, enabled]);

  return { bill, now };
}
