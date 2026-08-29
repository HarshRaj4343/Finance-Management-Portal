// UploadBill.tsx
"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { BillFormData } from "./types";
import { api, money } from "@/lib/api";
import { routeAfter, AUDIT_THRESHOLD } from "@/lib/roles";
import type { EmployeeRow, PdaBalanceRow, BillRow } from "@/types/database";

interface UploadBillProps {
  onBillSubmitted: () => void;
  department?: string | null;
}

type LookupResult = {
  found: boolean;
  employee?: EmployeeRow;
  pda?: PdaBalanceRow | null;
  message?: string | null;
};

const EMPTY: BillFormData = {
  employee_id: "",
  employee_name: "",
  po_details: "",
  po_value: "",
  supplier_name: "",
  supplier_address: "",
  item_category: "Minor",
  item_description: "",
  qty: "",
  bill_details: "",
  indenter_name: "",
  qty_issued: "",
  source_of_fund: "",
  stock_entry: "",
  location: "",
};

const UploadBill: React.FC<UploadBillProps> = ({ onBillSubmitted, department }) => {
  const [formData, setFormData] = useState<BillFormData>(EMPTY);
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [looking, setLooking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const balance = lookup?.pda ? Number(lookup.pda.balance) : null;
  const applicantDepartment = lookup?.employee?.department ?? null;

  /**
   * Look the employee up as the ID is typed. One exact match against the
   * server, debounced -- the prototype tried four `like` patterns from the
   * browser on every keystroke because employee codes had stray whitespace
   * in them. A CHECK constraint now keeps them clean.
   */
  const runLookup = useCallback(async (code: string) => {
    const id = code.trim();
    if (!id) {
      setLookup(null);
      return;
    }
    setLooking(true);
    const { data, error } = await api.get<LookupResult>(
      `/api/lookup/employee?code=${encodeURIComponent(id)}`
    );
    setLooking(false);
    if (error) {
      setLookup({ found: false, message: error });
      return;
    }
    setLookup(data);
    // Fill the name in for them once we know it.
    if (data?.found && data.employee) {
      setFormData((f) =>
        f.employee_name.trim() === ""
          ? { ...f, employee_name: data.employee!.employee_name }
          : f
      );
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => runLookup(formData.employee_id), 350);
    return () => clearTimeout(t);
  }, [formData.employee_id, runLookup]);

  const billValue = parseFloat(String(formData.po_value).replace(/,/g, ""));
  const amountIsValid = Number.isFinite(billValue) && billValue > 0;

  // Where this bill will go, so the filer can see it before submitting.
  const firstStop = amountIsValid
    ? routeAfter("Submit", formData.item_category, billValue)
    : null;

  const insufficient =
    amountIsValid && balance !== null && billValue > balance;

  const departmentConflict =
    (department ?? "").trim() &&
    (applicantDepartment ?? "").trim() &&
    department!.trim() !== applicantDepartment!.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(null);

    if (!formData.employee_id.trim() || !formData.employee_name.trim()) {
      setError("An employee ID and a name are both required.");
      return;
    }
    if (!amountIsValid) {
      setError("Enter a bill amount greater than zero.");
      return;
    }
    if (!lookup?.found) {
      setError(lookup?.message ?? "That employee ID could not be found.");
      return;
    }
    if (departmentConflict) {
      setError(
        `This page is filing for ${department}, but ${formData.employee_id} belongs to ${applicantDepartment}.`
      );
      return;
    }
    if (insufficient) {
      setError(
        `Insufficient PDA balance. ${money(balance)} is available and this bill is ${money(billValue)}.`
      );
      return;
    }

    setSubmitting(true);
    // The balance check, the insert, the reservation against the PDA and
    // the event log all happen inside one database transaction. If any of
    // it fails, none of it happened.
    const { data, error: err } = await api.post<{ bill: BillRow }>("/api/bills", {
      ...formData,
      po_value: billValue,
    });
    setSubmitting(false);

    if (err) {
      setError(err);
      return;
    }

    setDone(
      `Bill ${data!.bill.bill_number} filed. ${money(billValue)} is reserved against the PDA of ${formData.employee_id}, and it is now with ${data!.bill.status}.`
    );
    setFormData(EMPTY);
    setLookup(null);
    onBillSubmitted();
  };

  return (
    <div className="w-full max-w-3xl mx-auto relative">
      <h1 className="text-2xl font-semibold mb-6">
        Upload Bill{department ? ` for ${department}` : ""}{" "}
      </h1>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {done && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {done}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-2 gap-4 bg-white shadow p-6 rounded-lg border"
      >
        {(Object.keys(formData) as (keyof BillFormData)[]).map((field) => (
          <div key={field} className="col-span-1">
            <label className="block text-gray-700">
              {field.replace(/_/g, " ")}
            </label>
            {field === "item_category" ? (
              <select
                value={formData[field]}
                onChange={(e) =>
                  setFormData({ ...formData, [field]: e.target.value })
                }
                className="w-full border p-2 rounded"
              >
                <option>Minor</option>
                <option>Major</option>
                <option>Consumables</option>
              </select>
            ) : (
              <input
                type={
                  field.includes("qty") || field.includes("value")
                    ? "number"
                    : "text"
                }
                value={formData[field]}
                onChange={(e) =>
                  setFormData({ ...formData, [field]: e.target.value })
                }
                onWheel={
                  field.includes("value")
                    ? (e) => (e.currentTarget as HTMLInputElement).blur()
                    : undefined
                }
                className={`w-full border p-2 rounded ${
                  field === "employee_id" && lookup && !lookup.found
                    ? "border-red-400"
                    : ""
                }`}
                required={field === "employee_id" || field === "employee_name"}
              />
            )}

            {/* what we know about the ID that was typed */}
            {field === "employee_id" && (
              <p className="mt-1 text-xs">
                {looking && <span className="text-gray-400">Looking up…</span>}
                {!looking && lookup && !lookup.found && (
                  <span className="text-red-600">{lookup.message}</span>
                )}
                {!looking && lookup?.found && (
                  <span className="text-gray-500">
                    {lookup.employee?.employee_name} · {lookup.employee?.department}
                  </span>
                )}
              </p>
            )}

            {field === "po_value" && amountIsValid && (
              <p className="mt-1 text-xs text-gray-500">
                {insufficient ? (
                  <span className="text-red-600">
                    Over the available balance by {money(billValue - (balance ?? 0))}.
                  </span>
                ) : (
                  <>
                    Goes to <strong>{firstStop}</strong> first
                    {billValue > AUDIT_THRESHOLD
                      ? " (above ₹50,000, so Audit will see it)"
                      : ""}
                    .
                  </>
                )}
              </p>
            )}
          </div>
        ))}

        <div className="col-span-2">
          <motion.button
            type="submit"
            whileTap={{ scale: 0.95 }}
            disabled={submitting || Boolean(insufficient) || !lookup?.found}
            className="w-full bg-blue-600 text-white py-2 rounded-lg shadow disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Submitting…" : "Submit Bill"}
          </motion.button>
        </div>

        {balance !== null && (
          <div className="col-span-2 flex justify-between items-center text-gray-600">
            <span>
              Current PDA Balance:
              <br />
              {money(balance)}
              {lookup?.pda && Number(lookup.pda.committed) > 0 && (
                <span className="block text-xs text-gray-400">
                  {money(lookup.pda.committed)} already committed to bills in progress
                </span>
              )}
            </span>
            {applicantDepartment && (
              <span className="font-medium text-gray-800">
                Applicants department:
                <br /> {applicantDepartment}
              </span>
            )}
          </div>
        )}
      </form>
    </div>
  );
};

export default UploadBill;
