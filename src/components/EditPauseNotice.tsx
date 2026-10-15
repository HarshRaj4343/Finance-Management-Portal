"use client";

import type { Bill } from "@/types/database";
import { EDIT_PAUSE_LIMIT_MINUTES, editPauseAllowanceLeft, editWindowLeft, editWindowPaused } from "@/lib/bill-review";

const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** What the edit timer is doing while the correction form is open. */
export default function EditPauseNotice({ bill, now, closeHint = "close the form" }: {
  bill: Bill | null; now: number; closeHint?: string;
}) {
  if (!bill) return <>Pausing the edit timer…</>;
  const left = editWindowLeft(bill, now);
  if (left <= 0) return <>The edit window has closed; the bill is with its desk.</>;
  if (editWindowPaused(bill, now)) {
    return (
      <>
        Timer paused with <strong className="tabular-nums">{clock(left)}</strong> left; it resumes when you {closeHint}.
        {" "}Pausing allowed for <span className="tabular-nums">{clock(editPauseAllowanceLeft(bill, now))}</span> more.
      </>
    );
  }
  return (
    <>
      The {EDIT_PAUSE_LIMIT_MINUTES}-minute pause limit for this bill is used up. Save within{" "}
      <strong className="tabular-nums">{clock(left)}</strong>.
    </>
  );
}
