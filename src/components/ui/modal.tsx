"use client";

import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";
import { cn } from "@/lib/utils";

const SIZES = { sm: "sm:max-w-md", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" } as const;

/** Shared button styles, so every dialog and page action looks the same. */
export const btn = {
  primary: "inline-flex h-9 items-center justify-center gap-2 rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50",
  secondary: "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50",
  danger: "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-red-300 bg-white px-4 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50",
} as const;

/** Inputs inside dialogs and forms. */
export const fieldClass =
  "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:bg-slate-50 disabled:text-slate-500 read-only:bg-slate-50 read-only:text-slate-600";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

/**
 * The one dialog the portal uses: titled, focus-trapped, closes on Escape
 * and outside click, scrolls its body, keeps its actions in a footer.
 */
export default function Modal({ open = true, onClose, title, description, children, footer, size = "md" }: {
  open?: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof SIZES;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className={cn("flex max-h-[90vh] flex-col gap-0 overflow-hidden bg-white p-0 text-slate-900", SIZES[size])}>
        <div className="border-b border-slate-200 px-6 py-4 pr-12">
          <DialogTitle className="text-lg font-semibold text-slate-900">{title}</DialogTitle>
          {description ? (
            <DialogDescription className="mt-1 text-sm text-slate-600">{description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{title}</DialogDescription>
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-6 py-4">{footer}</div>}
      </DialogContent>
    </Dialog>
  );
}
