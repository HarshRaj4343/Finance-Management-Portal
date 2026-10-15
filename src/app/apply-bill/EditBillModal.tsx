"use client";
import { useState } from "react";
import type { Bill } from "./types";
import UploadBill from "./UploadBill";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { deskRemark, inEditWindow } from "@/lib/bill-review";
import { useEditWindowPause } from "@/lib/useEditWindowPause";
import EditPauseNotice from "@/components/EditPauseNotice";

export default function EditBillModal({ bill, onClose, onBillUpdated }: {
  bill: Bill; onClose: () => void; onBillUpdated: () => void;
}) {
  const rejected = bill.status === "Rejected";
  const remark = deskRemark(bill);
  // The edit window stops while this form is open and restarts when it closes.
  const [windowed] = useState(() => inEditWindow(bill));
  const pause = useEditWindowPause(bill.id, windowed, onBillUpdated);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogTitle>{rejected ? "Correct and resubmit rejected bill" : windowed ? "Correct bill" : "Correct held bill"}</DialogTitle>
        <DialogDescription>
          Complete details are required. Resubmitting invalidates earlier approvals and restarts the required approval route.
          {rejected && " Its funds were released on rejection; the corrected amount will be reserved against the PDA again."}
          {!bill.form_data && " This legacy bill has no structured form; complete the missing fields before resubmitting."}
        </DialogDescription>
        {windowed && (
          <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
            <EditPauseNotice bill={pause.bill} now={pause.now} />
          </p>
        )}
        {remark && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <strong>{rejected ? "Reason for rejection" : "Reason for hold"}:</strong> {remark}
          </p>
        )}
        <UploadBill key={bill.id + ":" + bill.revision} initialBill={bill} department={bill.employee_department}
          onBillSubmitted={() => { onBillUpdated(); onClose(); }} />
      </DialogContent>
    </Dialog>
  );
}
