// BillsHistory.tsx
import React, { useState } from "react";
import { api, money } from "@/lib/api";
import { Bill } from "./types";
import EditBillModal from "./EditBillModal";
import { useConfirm } from "@/components/ConfirmProvider";
import { canCorrectBill, deskRemark } from "@/lib/bill-review";
import Link from "next/link";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "@/components/ui/page";

interface BillsHistoryProps {
  bills: Bill[];
  loading: boolean;
  onBillUpdated: () => void;
  allowNote?: boolean;      // acknowledge a rejected bill; never delete it
  enableEdit?: boolean;     // if false, hide Edit UI completely
  onBillNoted?: (billId: string) => void; // Callback when a bill is noted
}

const BillsHistory: React.FC<BillsHistoryProps> = ({ 
  bills, 
  loading, 
  onBillUpdated,
  allowNote = false,
  enableEdit = true,
  onBillNoted,
}) => {
  const confirm = useConfirm();
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const [notingId, setNotingId] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);

  // Held or rejected by a desk, or still inside its edit window.
  const canEditBill = (bill: Bill) => canCorrectBill(bill);

  /**
   * Acknowledge a rejected bill and clear it from this list.
   *
   * This moves no money. It used to credit the bill's value back to the
   * PDA by hand, because a rejection left the amount debited -- the
   * database now releases the reservation at the moment of rejection, so
   * doing it here as well would credit the same amount twice.
   */
  const handleNoted = async (billId: string) => {
    if (!allowNote || !onBillNoted) return;

    const confirmed = await confirm({
      title: "Dismiss this rejected bill?",
      description: "It will be cleared from this list and can no longer be edited and resubmitted from here. The bill and its history remain in the portal.",
      confirmLabel: "Dismiss",
    });
    if (!confirmed) return;

    setNotingId(billId);
    const { error } = await api.post(`/api/bills/${billId}/note`, {});
    setNotingId(null);

    if (error) {
      setNoteError(error);
      return;
    }

    setNoteError(null);
    onBillNoted(billId);
  };


  const rejectedBy = (bill: Bill) =>
    bill.finance_admin === "Reject" ? "Finance Admin" : bill.audit === "Reject" ? "Audit" : bill.snp === "Reject" ? "Store and Purchase Department" : bill.status;
  const th = "px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rejected Bills"
        description="Correct and resubmit a rejected bill, or dismiss it to clear it from this list. Its funds were released when it was rejected."
      />
      {noteError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{noteError}</p>}
      {loading ? <LoadingState label="Loading rejected bills…" /> : bills.length === 0 ? (
        <EmptyState title="No rejected bills" description="Bills a desk rejects appear here until you resubmit or dismiss them." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Bill</th>
                <th className={`${th} text-right`}>Amount</th>
                <th className={th}>Rejected by</th>
                <th className={th}>Reason</th>
                <th className={th}>Filed</th>
                {(enableEdit || allowNote) && <th className={th}><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bills.map((bill) => (
                <tr key={bill.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/bill/${bill.id}`} className="whitespace-nowrap font-mono text-xs font-medium text-blue-700 hover:underline">{bill.bill_number ?? "—"}</Link>
                    <p className="whitespace-nowrap font-medium text-slate-900">{bill.employee_name} ({bill.employee_id})</p>
                    <p className="max-w-[16rem] truncate text-xs text-slate-500" title={bill.po_details ?? ""}>{bill.item_category} · {bill.po_details || "No PO"}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(bill.po_value)}</td>
                  <td className="px-4 py-3"><StatusBadge value={rejectedBy(bill)} /></td>
                  <td className="min-w-[16rem] max-w-md px-4 py-3 text-slate-700">{deskRemark(bill) ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{new Date(bill.created_at).toLocaleDateString("en-IN")}</td>
                  {(enableEdit || allowNote) && (
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {enableEdit && (
                        <button
                          onClick={() => setEditingBill(bill)}
                          disabled={!canEditBill(bill)}
                          className="inline-flex h-8 items-center rounded-md bg-blue-700 px-3 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                        >
                          Edit &amp; resubmit
                        </button>
                      )}
                      {allowNote && (
                        <button
                          onClick={() => handleNoted(bill.id)}
                          title="Clear this bill from the list without resubmitting it"
                          disabled={notingId === bill.id}
                          className="ml-2 inline-flex h-8 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {notingId === bill.id ? "Dismissing..." : "Dismiss"}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {enableEdit && editingBill && (
        <EditBillModal
          bill={editingBill}
          onClose={() => setEditingBill(null)}
          onBillUpdated={onBillUpdated}
        />
      )}
    </div>
  );
};

export default BillsHistory;
