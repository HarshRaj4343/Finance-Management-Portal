// EditBillModal.tsx
import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { AUDIT_THRESHOLD } from "@/lib/roles";
import { Bill, BillFormData } from "./types";

interface EditBillModalProps {
  bill: Bill;
  onClose: () => void;
  onBillUpdated: () => void;
}

const EditBillModal: React.FC<EditBillModalProps> = ({ 
  bill, 
  onClose, 
  onBillUpdated 
}) => {
  const [formData, setFormData] = useState<BillFormData>({
    employee_id: bill.employee_id,
    employee_name: bill.employee_name ?? "",
    po_details: bill.po_details || "",
    po_value: bill.po_value?.toString() || "",
    supplier_name: bill.supplier_name || "",
    supplier_address: bill.supplier_address || "",
    item_category: bill.item_category || "Minor",
    item_description: bill.item_description || "",
    qty: bill.qty?.toString() || "",
    bill_details: bill.bill_details || "",
    indenter_name: bill.indenter_name || "",
    qty_issued: bill.qty_issued?.toString() || "",
    source_of_fund: bill.source_of_fund || "",
    stock_entry: bill.stock_entry || "",
    location: bill.location || "",
  });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [originalBillValue] = useState(bill.po_value || 0);

  // What is still free on this employee's PDA, so the form can say whether
  // an increase will fit. One exact lookup: employee codes are trimmed by a
  // CHECK constraint, so the three fallback patterns that used to be here
  // have nothing left to catch.
  useEffect(() => {
    const fetchBalance = async () => {
      const code = (bill.employee_id ?? "").toString().trim();
      if (!code) {
        setBalance(null);
        return;
      }
      const { data, error: err } = await api.get<{
        found: boolean;
        pda: { balance: number } | null;
      }>(`/api/lookup/employee?code=${encodeURIComponent(code)}`);

      if (err || !data?.found || !data.pda) {
        setBalance(null);
        return;
      }
      setBalance(Number(data.pda.balance));
    };
    fetchBalance();
  }, [bill.employee_id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const newBillValue = parseFloat(formData.po_value);

    // A correction may not carry the bill across the ₹50,000 line. Doing so
    // would change which desks it should have visited, and the ones it has
    // already been through cannot be un-visited. Such a bill has to be
    // rejected and filed afresh.
    const wasAbove = originalBillValue > AUDIT_THRESHOLD;
    const isAbove = newBillValue > AUDIT_THRESHOLD;
    if (wasAbove !== isAbove) {
      setError(
        wasAbove
          ? `This bill was filed above ₹${AUDIT_THRESHOLD.toLocaleString("en-IN")}, so it has been routed through Audit. A correction cannot bring it below that line — the bill would need to be rejected and filed again.`
          : `This bill was filed at or below ₹${AUDIT_THRESHOLD.toLocaleString("en-IN")}, so it skipped Audit. A correction cannot take it above that line — the bill would need to be rejected and filed again.`
      );
      setLoading(false);
      return;
    }

    // Validation
    if (!formData.employee_id || !formData.employee_name) {
      setError("An employee ID and a name are both required.");
      setLoading(false);
      return;
    }

    if (isNaN(newBillValue) || newBillValue <= 0) {
      setError("Enter a bill amount greater than zero.");
      setLoading(false);
      return;
    }

    /**
     * One call does the lot.
     *
     * fn_amend_bill moves the PDA reservation with the amount -- taking
     * more from the free balance if the bill went up, giving some back if
     * it went down -- updates the bill, and puts it back in the queue at
     * whichever desk was holding it, all in one transaction.
     *
     * This used to be two separate writes from the browser: adjust the
     * balance, then update the bill. If the second one failed, the money
     * and the bill disagreed and nothing said so.
     */
    const { error: err } = await api.patch(`/api/bills/${bill.id}`, {
      ...formData,
      po_value: newBillValue,
      qty: formData.qty || null,
      qty_issued: formData.qty_issued || null,
    });

    setLoading(false);

    if (err) {
      setError(err);
      return;
    }

    onBillUpdated();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto"
      >
        {error && (
          <div className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold text-gray-900">Edit Bill</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl"
              disabled={loading}
            >
              ×
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="grid grid-cols-2 gap-4 mb-6">
            {Object.keys(formData).map((field) => (
              <div key={field} className="col-span-1">
                <label className="block text-gray-700 font-medium mb-1">
                  {field.replace(/_/g, " ")}
                  {(field === "employee_id" || field === "employee_name") && (
                    <span className="text-red-500">*</span>
                  )}
                </label>
                {field === "item_category" ? (
                  <div className="w-full p-2 rounded border border-gray-200 bg-gray-50 text-gray-800 select-none cursor-not-allowed">
                    {formData[field as keyof BillFormData]}
                  </div>
                ) : (
                  <input
                    type={
                      field.includes("qty") || field.includes("value")
                        ? "number"
                        : "text"
                    }
                    value={formData[field as keyof BillFormData]}
                    onChange={(e) =>
                      setFormData({ ...formData, [field]: e.target.value })
                    }
                    onWheel={field.includes("value") ? (e) => (e.target as HTMLInputElement).blur() : undefined}
                    className="w-full border border-gray-300 p-2 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required={
                      field === "employee_id" || field === "employee_name"
                    }
                    disabled={
                      loading || 
                      field === "employee_id" || 
                      field === "employee_name"
                    }
                  />
                )}
              </div>
            ))}
          </div>

          {balance !== null && (
            <div className="mb-4 p-3 bg-blue-50 rounded-lg">
              <div className="text-sm text-gray-600">
                <p>Current PDA Balance: ₹ {balance.toFixed(2)}</p>
                <p>Original Bill Value: ₹ {originalBillValue.toFixed(2)}</p>
                {parseFloat(formData.po_value) !== originalBillValue && (
                  <p className="font-medium">
                    Balance after update: ₹ {(balance - (parseFloat(formData.po_value) - originalBillValue)).toFixed(2)}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
              disabled={loading}
            >
              Cancel
            </button>
            <motion.button
              type="submit"
              whileTap={{ scale: 0.95 }}
              className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              disabled={loading}
            >
              {loading ? "Updating..." : "Update Bill"}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};

export default EditBillModal;