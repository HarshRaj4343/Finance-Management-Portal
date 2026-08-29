"use client";

import React, { useEffect } from "react";

/**
 * The message that used to be a browser alert().
 *
 * alert() blocks the whole tab, cannot be styled, cannot show two things
 * at once and reads as a browser error rather than as the portal talking
 * to you. This sits at the top of the page in the portal's own colours and
 * clears itself.
 */
export type NoticeState = { kind: "ok" | "bad" | "info"; text: string } | null;

const TONE = {
  ok: "border-green-200 bg-green-50 text-green-900",
  bad: "border-red-200 bg-red-50 text-red-900",
  info: "border-sky-200 bg-sky-50 text-sky-900",
} as const;

export default function Notice({
  notice,
  onDismiss,
  autoDismissMs = 6000,
}: {
  notice: NoticeState;
  onDismiss: () => void;
  autoDismissMs?: number;
}) {
  useEffect(() => {
    // Errors stay until they are read; confirmations fade.
    if (!notice || notice.kind === "bad") return;
    const t = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(t);
  }, [notice, onDismiss, autoDismissMs]);

  if (!notice) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-4 z-50 w-[min(38rem,calc(100vw-2rem))] -translate-x-1/2"
    >
      <div
        className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${TONE[notice.kind]}`}
      >
        <span className="flex-1 leading-relaxed">{notice.text}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded px-1 text-lg leading-none opacity-50 hover:opacity-100"
        >
          ×
        </button>
      </div>
    </div>
  );
}
