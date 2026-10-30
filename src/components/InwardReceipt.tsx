"use client";

import { useState } from "react";
import { IconInbox } from "@tabler/icons-react";
import { api, when } from "@/lib/api";
import { deskLabel, normaliseRole } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type { Bill } from "@/types/database";

type Inward = NonNullable<Bill["inward"]>;

/**
 * The bill's inward register entry at the desk it is waiting at: its
 * number and the Received tick, the same mark as on the register page.
 * The desk decides the bill only once it is ticked (0011). Its own desk
 * and the Dean may tick it; anyone else sees it read-only.
 */
export default function InwardReceipt({ bill, actorRole, onChange }: {
  bill: Bill;
  actorRole?: string | null;
  onChange: (inward: Inward) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inward = bill.inward;
  if (!inward) return null;
  const role = normaliseRole(actorRole);
  const canMark = role === "Dean" || role === bill.status;

  const mark = async (received: boolean) => {
    setBusy(true); setError(null);
    const { data, error } = await api.post<{ receipt: { received: boolean; received_by_name: string | null; received_at: string | null } }>(
      `/api/movements/${inward.id}/receipt`, { received });
    setBusy(false);
    if (error || !data) { setError(error ?? "Could not mark the entry."); return; }
    onChange({ ...inward, received: data.receipt.received, received_by: data.receipt.received_by_name, received_at: data.receipt.received_at });
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-sm",
      inward.received ? "border-green-200 bg-green-50 text-green-900" : "border-amber-300 bg-amber-50 text-amber-950")}>
      <span className="inline-flex items-center gap-2">
        <IconInbox className="size-4 shrink-0" aria-hidden="true" />
        Inward no. <span className="font-mono text-xs">{inward.serial_no}</span>
      </span>
      <label className={cn("inline-flex items-center gap-2 font-medium", canMark ? "cursor-pointer" : "cursor-not-allowed opacity-70")}
        title={canMark ? undefined : `Only ${deskLabel(bill.status)} or the Dean can mark this entry`}>
        <input type="checkbox" checked={inward.received} disabled={!canMark || busy} data-inward-receipt
          onChange={(e) => mark(e.target.checked)}
          aria-label={`${inward.serial_no}: ${inward.received ? "Received" : "Not received"}`}
          className="size-4 rounded border-slate-300 accent-green-700" />
        {inward.received ? "Received" : "Not received"}
      </label>
      <span className="text-xs">
        {inward.received
          ? `Marked by ${inward.received_by ?? "—"}${inward.received_at ? `, ${when(inward.received_at)}` : ""}`
          : "Tick Received once the bill's file has reached this desk. You can decide it after that."}
      </span>
      {error && <span role="alert" className="w-full text-xs text-red-700">{error}</span>}
    </div>
  );
}
