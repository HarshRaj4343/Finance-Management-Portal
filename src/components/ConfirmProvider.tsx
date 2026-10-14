"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "./ui/alert-dialog";

export type ConfirmOptions = {
  title: string;
  description?: string;
  /** Label/value pairs summarising what is about to happen. */
  details?: [string, ReactNode][];
  confirmLabel?: string;
  tone?: "default" | "danger";
};

type Ask = (options: ConfirmOptions) => Promise<boolean>;

// Outside the provider (tests, stray renders) fall back to the browser's own prompt.
const ConfirmContext = createContext<Ask>(async (o) =>
  typeof window !== "undefined" && window.confirm(o.title));

/**
 * One confirmation step before any decision that moves a bill, money or
 * someone's access. Cancel has the initial focus, so a stray Enter never
 * confirms. This is a deliberate second click, not OTP-based 2FA.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [asking, setAsking] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  const ask = useCallback<Ask>((options) => {
    resolver.current?.(false);
    setAsking(options);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  const settle = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setAsking(null);
  };

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <AlertDialog open={asking !== null} onOpenChange={(open) => { if (!open) settle(false); }}>
        <AlertDialogContent onOpenAutoFocus={(e) => { e.preventDefault(); cancelButton.current?.focus(); }}>
          <AlertDialogTitle>{asking?.title}</AlertDialogTitle>
          <AlertDialogDescription>{asking?.description ?? "Please confirm before you continue."}</AlertDialogDescription>
          {asking?.details && asking.details.length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-slate-50 p-3 text-sm">
              {asking.details.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-slate-600">{label}</dt>
                  <dd className="break-words whitespace-pre-wrap font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <button ref={cancelButton} type="button" className="rounded-lg border px-4 py-2">Cancel</button>
            </AlertDialogCancel>
            <button type="button" onClick={() => settle(true)}
              className={`rounded-lg px-4 py-2 text-white ${asking?.tone === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-blue-700 hover:bg-blue-800"}`}>
              {asking?.confirmLabel ?? "Confirm"}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

/** `if (!(await confirm({ title: "..." }))) return;` */
export const useConfirm = () => useContext(ConfirmContext);
