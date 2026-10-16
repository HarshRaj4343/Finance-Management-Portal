"use client";

import { useState } from "react";
import { IconArrowBackUp, IconPencil } from "@tabler/icons-react";
import UploadBill from "@/app/apply-bill/UploadBill";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { when } from "@/lib/api";
import { deskLabel } from "@/lib/roles";
import { sentBackHere } from "@/lib/bill-review";
import type { Bill } from "@/types/database";

/**
 * Shown on a bill another desk sent back to this one (0010_send_back.sql):
 * who sent it, why, and -- for someone who may decide it -- the full bill
 * form to correct it before approving it again.
 */
export default function SentBackNotice({ bill, canCorrect, onCorrected }: {
  bill: Bill;
  canCorrect: boolean;
  onCorrected: (updated: Bill) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  if (!sentBackHere(bill)) return null;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="flex items-start gap-2">
        <IconArrowBackUp className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          <strong>Sent back by {deskLabel(bill.returned_from)}</strong>
          {bill.returned_at ? ` on ${when(bill.returned_at)}` : ""}.{" "}
          {bill.returned_remark ? <>Reason: {bill.returned_remark}</> : "No reason was given."}
        </span>
      </p>
      {canCorrect && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setEditing(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-400 bg-white px-3 font-medium text-amber-950 hover:bg-amber-100">
            <IconPencil className="size-4" aria-hidden="true" /> Correct bill
          </button>
          <span className="text-xs text-amber-900">Correct it if needed, then approve it to send it on.</span>
        </div>
      )}
      {editing && (
        <Dialog open onOpenChange={(open) => { if (!open) setEditing(false); }}>
          <DialogContent className="sm:max-w-6xl max-h-[90vh] overflow-y-auto">
            <DialogTitle>Correct bill sent back by {deskLabel(bill.returned_from)}</DialogTitle>
            <DialogDescription>
              You may change any detail, including items, prices and the source of fund; the reservation follows the new amount.
              The bill stays at {deskLabel(bill.status)}. Every change is kept in the bill&apos;s revision history.
            </DialogDescription>
            <UploadBill key={bill.id + ":" + bill.revision} initialBill={bill} department={bill.employee_department} deskCorrection
              onBillSubmitted={async (updated) => { setEditing(false); if (updated) await onCorrected({ ...bill, ...updated }); }} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
