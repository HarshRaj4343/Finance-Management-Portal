"use client";
import type { Bill } from "./types";
import UploadBill from "./UploadBill";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export default function EditBillModal({ bill, onClose, onBillUpdated }: {
  bill: Bill; onClose: () => void; onBillUpdated: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogTitle>Correct held bill</DialogTitle>
        <DialogDescription>
          Complete details are required. Resubmitting invalidates earlier approvals and restarts the required approval route.
          {!bill.form_data && " This legacy bill has no structured form; complete the missing fields before resubmitting."}
        </DialogDescription>
        <UploadBill key={bill.id + ":" + bill.revision} initialBill={bill} department={bill.employee_department}
          onBillSubmitted={() => { onBillUpdated(); onClose(); }} />
      </DialogContent>
    </Dialog>
  );
}
