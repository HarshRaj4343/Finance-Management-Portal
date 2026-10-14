"use client";

import { useEffect, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "./ui/alert-dialog";
import { SESSION_MAX_MS, SESSION_WARN_MS } from "@/lib/session-limits";

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * A sign-in lasts a fixed eight hours. Five minutes before it ends this
 * warns, counting down, so nobody loses a half-written remark; at the end it
 * signs out and the login page says why. Bill-form drafts are autosaved.
 */
export default function SessionExpiryWarning() {
  const { data: session, status } = useSession();
  const signedInAt = session?.signedInAt;
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(false);
  const ended = useRef(false);
  const deadline = signedInAt ? signedInAt + SESSION_MAX_MS : null;
  const left = deadline ? deadline - now : Infinity;

  useEffect(() => {
    if (status !== "authenticated" || !deadline) return;
    // Tick once a minute until the warning period, then every second.
    const t = setInterval(() => setNow(Date.now()), left <= SESSION_WARN_MS + 60_000 ? 1000 : 60_000);
    return () => clearInterval(t);
  }, [status, deadline, left]);

  useEffect(() => {
    if (status === "authenticated" && deadline && left <= 0 && !ended.current) {
      ended.current = true;
      signOut({ callbackUrl: `/login?expired=1&callbackUrl=${encodeURIComponent(window.location.pathname)}` });
    }
  }, [status, deadline, left]);

  const open = status === "authenticated" && left > 0 && left <= SESSION_WARN_MS && !dismissed;
  const signInAgain = () =>
    signOut({ callbackUrl: `/login?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}` });

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogTitle>Your session ends in {mmss(left)}</AlertDialogTitle>
        <AlertDialogDescription>
          For security, a sign-in lasts eight hours. Finish or save what you are doing, then sign in again to continue.
          Bill forms you are filling in are saved as drafts automatically.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <button type="button" onClick={() => setDismissed(true)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Keep working
          </button>
          <button type="button" onClick={signInAgain} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800">
            Sign in again now
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
