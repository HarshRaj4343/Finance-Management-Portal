"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import QRCode from "react-qr-code";
import { api, money, when } from "@/lib/api";
import type { Bill, BillApproval, RegisterEntry, Employee } from "@/types/database";

/**
 * One bill, its whole life.
 *
 * architecture.jpeg: "QR Code Generation" leads here. Scanning the sticker
 * on a purchased item opens this page, which shows what was bought, where
 * it is logged in the departmental register, and every step it took to get
 * approved -- when, and at whose desk.
 *
 * The portal is for internal use, so the page asks the reader to sign in
 * first. A plain user can only open their own bills; anybody holding a
 * workflow role can open any of them.
 */

type Payload = {
  bill: Bill;
  events: BillApproval[];
  register: RegisterEntry | null;
  applicant: Pick<Employee, "employee_code" | "employee_name" | "email" | "department"> | null;
  route: string[];
  error?: string;
};

const statusColor = (status: string) => {
  switch (status) {
    case "Accepted":
      return "text-green-600 bg-green-100";
    case "Rejected":
      return "text-red-600 bg-red-100";
    case "Finance Admin":
      return "text-blue-600 bg-blue-100";
    case "Audit":
      return "text-yellow-600 bg-yellow-100";
    case "Student Purchase":
      return "text-purple-600 bg-purple-100";
    default:
      return "text-gray-600 bg-gray-100";
  }
};

const dotColor = (action: string) => {
  switch (action) {
    case "Approved":
      return "bg-green-600";
    case "Rejected":
      return "bg-red-600";
    case "Hold":
      return "bg-yellow-500";
    case "Submitted":
      return "bg-blue-600";
    case "Registered":
      return "bg-blue-600";
    default:
      return "bg-gray-300";
  }
};

export default function BillDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const { status: authStatus } = useSession();

  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") setQrUrl(window.location.href);
  }, []);

  useEffect(() => {
    if (authStatus === "loading") return;

    if (authStatus === "unauthenticated") {
      // Come back here once they have signed in.
      window.location.href = `/login?callbackUrl=${encodeURIComponent(`/bill/${id}`)}`;
      return;
    }
    if (!id) return;

    const load = async () => {
      setLoading(true);
      const { data, error: err } = await api.get<Payload>(`/api/bills/${id}`);
      setLoading(false);
      if (err) {
        setError(err);
        return;
      }
      setPayload(data);
    };
    load();
  }, [id, authStatus]);

  if (authStatus === "loading" || loading)
    return (
      <div className="text-center mt-10 text-gray-500">Loading bill details...</div>
    );

  if (error || !payload?.bill)
    return (
      <div className="max-w-md mx-auto mt-10 bg-red-50 border border-red-200 text-red-800 rounded-lg px-5 py-4 text-center text-sm">
        {error ?? "Bill not found."}
      </div>
    );

  const { bill, events, register, applicant, route } = payload;

  // helper for pretty formatting
  const formatValue = (val: any) => {
    if (val === null || val === undefined || val === "NULL") return "—";
    if (typeof val === "boolean") return val ? "Yes" : "No";
    if (typeof val === "string" && val.trim() === "") return "—";
    return val;
  };

  return (
    <div className="max-w-4xl mx-auto bg-white shadow rounded-lg p-6 mt-10 mb-10">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-gray-800">Bill Details</h2>
          {bill.bill_number && (
            <p className="text-sm text-gray-500 mt-1">{bill.bill_number}</p>
          )}
        </div>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
        >
          Print Page
        </button>
      </div>

      {/* Status */}
      <div className="flex flex-wrap items-center gap-3 mb-6 pb-6 border-b">
        <span
          className={`px-3 py-1 rounded-full text-sm font-medium ${statusColor(bill.status)}`}
        >
          {bill.status === "Accepted"
            ? "Approved"
            : bill.status === "Rejected"
            ? "Rejected"
            : `With ${bill.status}`}
        </span>
        {register && (
          <span className="px-3 py-1 rounded-full text-sm bg-blue-50 text-blue-700 border border-blue-200">
            Register entry <strong>{register.serial_no}</strong>
          </span>
        )}
        <span className="text-sm text-gray-500">
          Filed {when(bill.created_at)}
          {bill.decided_at && ` · decided ${when(bill.decided_at)}`}
        </span>
      </div>

      {/* Approval route */}
      <div className="mb-6 print:hidden">
        <p className="text-sm font-medium text-gray-700 mb-2">
          Approval route for a {bill.item_category?.toLowerCase()} purchase of{" "}
          {money(bill.po_value)}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="px-2.5 py-1 rounded bg-gray-100 text-gray-600">Filed</span>
          {route.map((stop) => {
            const passed =
              events.some((e) => e.stage === stop && e.action === "Approved") ||
              bill.status === "Accepted";
            const here = bill.status === stop;
            const rejectedHere = events.some(
              (e) => e.stage === stop && e.action === "Rejected"
            );
            return (
              <React.Fragment key={stop}>
                <svg className="h-4 w-4 shrink-0 text-gray-300" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span
                  className={`px-2.5 py-1 rounded ${
                    rejectedHere
                      ? "bg-red-100 text-red-800"
                      : here
                      ? "bg-blue-600 text-white"
                      : passed
                      ? "bg-green-100 text-green-800"
                      : "bg-gray-100 text-gray-400"
                  }`}
                >
                  {stop}
                </span>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Details, in the original two-column layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-3 text-sm">
        <p><strong>Bill Number:</strong> {formatValue(bill.bill_number)}</p>
        <p><strong>Employee ID:</strong> {formatValue(bill.employee_id)}</p>
        <p><strong>Employee Name:</strong> {formatValue(applicant?.employee_name ?? bill.employee_name)}</p>
        <p><strong>Department:</strong> {formatValue(bill.employee_department)}</p>
        <p><strong>PO Details:</strong> {formatValue(bill.po_details)}</p>
        <p><strong>PO Value:</strong> {money(bill.po_value)}</p>
        <p><strong>Supplier Name:</strong> {formatValue(bill.supplier_name)}</p>
        <p><strong>Supplier Address:</strong> {formatValue(bill.supplier_address)}</p>
        <p><strong>Item Category:</strong> {formatValue(bill.item_category)}</p>
        <p><strong>Item Description:</strong> {formatValue(bill.item_description)}</p>
        <p><strong>Quantity:</strong> {formatValue(bill.qty)}</p>
        <p><strong>Quantity Issued:</strong> {formatValue(bill.qty_issued)}</p>
        <p><strong>Indenter Name:</strong> {formatValue(bill.indenter_name)}</p>
        <p><strong>Bill Details:</strong> {formatValue(bill.bill_details)}</p>
        <p><strong>Source of Fund:</strong> {formatValue(bill.source_of_fund)}</p>
        <p><strong>Stock Entry:</strong> {formatValue(bill.stock_entry)}</p>
        <p><strong>Location:</strong> {formatValue(bill.location)}</p>
        <p><strong>Status:</strong> {formatValue(bill.status)}</p>
        <p><strong>SNP:</strong> {formatValue(bill.snp)}</p>
        <p><strong>Audit:</strong> {formatValue(bill.audit)}</p>
        <p><strong>Finance Admin:</strong> {formatValue(bill.finance_admin)}</p>
        <p><strong>Noted:</strong> {formatValue(bill.noted)}</p>
        <p><strong>Created At:</strong> {when(bill.created_at)}</p>
      </div>

      {/* Bank guarantee, only when there is one */}
      {bill.has_bank_guarantee && (
        <>
          <h3 className="text-lg font-semibold text-gray-800 mt-8 mb-3">
            Bank Guarantee
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-3 text-sm">
            <p><strong>Reference:</strong> {formatValue(bill.bank_guarantee_details)}</p>
            <p><strong>Amount:</strong> {bill.bank_guarantee_amount ? money(bill.bank_guarantee_amount) : "—"}</p>
            <p><strong>Delivery Due:</strong> {when(bill.date_of_delivery)}</p>
            <p><strong>Installation Due:</strong> {when(bill.date_of_installation)}</p>
          </div>
        </>
      )}

      {/* Register entry */}
      {register && (
        <>
          <h3 className="text-lg font-semibold text-gray-800 mt-8 mb-3">
            Register Entry
          </h3>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-3 text-sm">
              <p><strong>Serial Number:</strong> {register.serial_no}</p>
              <p><strong>Financial Year:</strong> {register.financial_year}</p>
              <p><strong>Entered On:</strong> {when(register.recorded_at)}</p>
              <p><strong>Entered By:</strong> {formatValue(register.recorded_by)}</p>
              <p><strong>Department Register:</strong> {register.department}</p>
              <p><strong>Amount:</strong> {money(register.amount)}</p>
            </div>
            <p className="text-xs text-gray-500 mt-3 pt-3 border-t border-blue-200">
              This purchase is recorded permanently in the {register.department} register.
              Register entries cannot be edited or deleted.
            </p>
          </div>
        </>
      )}

      {/* History */}
      <h3 className="text-lg font-semibold text-gray-800 mt-8 mb-1">History</h3>
      <p className="text-xs text-gray-500 mb-5">
        Every step this bill took, in order. This log is append-only — entries cannot be
        edited or removed once written.
      </p>

      <ol className="relative space-y-6 border-l border-gray-200 pl-6 ml-2">
        {events.map((e) => (
          <li key={e.id} className="relative">
            <span
              className={`absolute -left-[1.85rem] top-1.5 h-3 w-3 rounded-full ring-4 ring-white ${dotColor(
                e.action
              )}`}
            />
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-medium text-gray-900 text-sm">
                {e.action === "Forwarded" ||
                e.action === "Registered" ||
                e.action === "Notified"
                  ? e.remark
                  : `${e.stage} — ${e.action}`}
              </span>
              <span className="text-xs text-gray-400">{when(e.created_at)}</span>
            </div>

            {e.actor_name && (
              <p className="mt-0.5 text-sm text-gray-500">
                {e.actor_name}
                {e.actor_code ? ` (${e.actor_code})` : ""}
                {e.actor_role ? ` · ${e.actor_role}` : ""}
              </p>
            )}

            {e.remark &&
              e.action !== "Forwarded" &&
              e.action !== "Registered" &&
              e.action !== "Notified" && (
                <p className="mt-1.5 bg-gray-50 border-l-2 border-gray-200 px-3 py-2 text-sm text-gray-700 rounded-r">
                  {e.remark}
                </p>
              )}
          </li>
        ))}
      </ol>

      {/* QR */}
      <div className="mt-8 pt-6 border-t flex flex-col items-center gap-3">
        {qrUrl && (
          <div className="bg-white p-3 border rounded-lg">
            <QRCode value={qrUrl} size={150} />
          </div>
        )}
        <p className="text-xs text-gray-500 text-center">
          Scan to reopen this record. Signing in is required.
        </p>
      </div>
    </div>
  );
}
