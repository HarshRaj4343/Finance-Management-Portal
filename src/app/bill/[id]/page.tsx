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

const STATUS_TONE: Record<string, string> = {
  Accepted: "bg-green-100 text-green-800 border-green-200",
  Rejected: "bg-red-100 text-red-800 border-red-200",
  "Finance Admin": "bg-sky-100 text-sky-800 border-sky-200",
  Audit: "bg-amber-100 text-amber-800 border-amber-200",
  "Student Purchase": "bg-violet-100 text-violet-800 border-violet-200",
  User: "bg-gray-100 text-gray-700 border-gray-200",
};

const ACTION_DOT: Record<string, string> = {
  Submitted: "bg-[#217093]",
  Approved: "bg-green-600",
  Rejected: "bg-red-600",
  Hold: "bg-amber-500",
  Forwarded: "bg-gray-300",
  Registered: "bg-[#217093]",
  Notified: "bg-gray-300",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  const empty =
    value === null || value === undefined || value === "" || value === "NULL";
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className={`mt-0.5 break-words ${empty ? "text-gray-300" : "text-gray-900"}`}>
        {empty ? "—" : value}
      </dd>
    </div>
  );
}

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
      const back = encodeURIComponent(`/bill/${id}`);
      window.location.href = `/login?callbackUrl=${back}`;
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

  if (authStatus === "loading" || loading) {
    return (
      <div className="mx-auto mt-20 max-w-md text-center text-gray-500">
        Loading bill details…
      </div>
    );
  }

  if (error || !payload?.bill) {
    return (
      <div className="mx-auto mt-20 max-w-md rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-center text-sm text-red-800">
        {error ?? "Bill not found."}
      </div>
    );
  }

  const { bill, events, register, applicant, route } = payload;
  const decided = bill.status === "Accepted" || bill.status === "Rejected";

  return (
    <div className="mx-auto mb-16 mt-8 max-w-5xl px-4 print:mt-0">
      {/* -------------------------------------------------- header */}
      <div className="rounded-t-lg bg-[#217093] px-6 py-5 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.08em] opacity-80">
              IIT Mandi · Integrated Finance Management Portal
            </p>
            <h1 className="mt-1 text-2xl font-semibold">
              {bill.bill_number ?? `Bill ${bill.id.slice(0, 8)}`}
            </h1>
            <p className="mt-1 text-sm opacity-90">
              {bill.item_description ?? "Purchase"} · {money(bill.po_value)}
            </p>
          </div>
          <button
            onClick={() => window.print()}
            className="rounded border border-white/40 px-4 py-2 text-sm hover:bg-white/10 print:hidden"
          >
            Print
          </button>
        </div>
      </div>

      <div className="rounded-b-lg border border-t-0 bg-white shadow-sm">
        {/* ---------------------------------------------- status strip */}
        <div className="flex flex-wrap items-center gap-3 border-b px-6 py-4">
          <span
            className={`rounded-full border px-3 py-1 text-sm font-medium ${
              STATUS_TONE[bill.status] ?? STATUS_TONE.User
            }`}
          >
            {bill.status === "Accepted"
              ? "Approved"
              : bill.status === "Rejected"
              ? "Rejected"
              : `With ${bill.status}`}
          </span>

          {register && (
            <span className="rounded-full border border-[#217093]/20 bg-[#217093]/5 px-3 py-1 text-sm text-[#1c5a76]">
              Register entry <strong>{register.serial_no}</strong>
            </span>
          )}

          <span className="text-sm text-gray-500">
            Filed {when(bill.created_at)}
            {decided && ` · decided ${when(bill.decided_at)}`}
          </span>
        </div>

        {/* ---------------------------------------------- route */}
        <div className="border-b px-6 py-4 print:hidden">
          <p className="mb-2 text-xs uppercase tracking-wide text-gray-400">
            Approval route for a {bill.item_category?.toLowerCase()} purchase of{" "}
            {money(bill.po_value)}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded bg-gray-100 px-2.5 py-1 text-gray-600">Filed</span>
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
                  <span className="text-gray-300">→</span>
                  <span
                    className={`rounded px-2.5 py-1 ${
                      rejectedHere
                        ? "bg-red-100 text-red-800"
                        : here
                        ? "bg-[#217093] text-white"
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

        <div className="grid gap-8 px-6 py-6 md:grid-cols-[1fr_auto]">
          {/* ------------------------------------------ the details */}
          <div className="min-w-0 space-y-8">
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
                Purchase
              </h2>
              <dl className="grid grid-cols-1 gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
                <Field label="Item" value={bill.item_description} />
                <Field label="Category" value={bill.item_category} />
                <Field label="Quantity" value={bill.qty} />
                <Field label="Quantity issued" value={bill.qty_issued} />
                <Field label="Amount" value={money(bill.po_value)} />
                <Field label="Supplier" value={bill.supplier_name} />
                <Field label="Supplier address" value={bill.supplier_address} />
                <Field label="PO details" value={bill.po_details} />
                <Field label="Invoice" value={bill.bill_details} />
                <Field label="Source of fund" value={bill.source_of_fund} />
                <Field label="Stock entry" value={bill.stock_entry} />
                <Field label="Location" value={bill.location} />
              </dl>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
                Applicant
              </h2>
              <dl className="grid grid-cols-1 gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
                <Field label="Employee" value={applicant?.employee_name ?? bill.employee_name} />
                <Field label="Employee ID" value={bill.employee_id} />
                <Field label="Department" value={bill.employee_department} />
                <Field label="Indenter" value={bill.indenter_name} />
              </dl>
            </section>

            {bill.has_bank_guarantee && (
              <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
                  Bank guarantee
                </h2>
                <dl className="grid grid-cols-1 gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
                  <Field label="Reference" value={bill.bank_guarantee_details} />
                  <Field
                    label="Amount"
                    value={
                      bill.bank_guarantee_amount ? money(bill.bank_guarantee_amount) : null
                    }
                  />
                  <Field label="Delivery due" value={when(bill.date_of_delivery)} />
                  <Field label="Installation due" value={when(bill.date_of_installation)} />
                </dl>
              </section>
            )}

            {register && (
              <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
                  Register entry
                </h2>
                <div className="rounded-lg border border-[#217093]/20 bg-[#217093]/[0.03] p-4">
                  <dl className="grid grid-cols-1 gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
                    <Field label="Serial number" value={<strong>{register.serial_no}</strong>} />
                    <Field label="Financial year" value={register.financial_year} />
                    <Field label="Entered on" value={when(register.recorded_at)} />
                    <Field label="Entered by" value={register.recorded_by} />
                    <Field label="Department register" value={register.department} />
                    <Field label="Amount" value={money(register.amount)} />
                  </dl>
                  <p className="mt-3 border-t border-[#217093]/10 pt-3 text-xs text-gray-500">
                    This purchase is recorded permanently in the {register.department}{" "}
                    register. Register entries cannot be edited or deleted.
                  </p>
                </div>
              </section>
            )}
          </div>

          {/* ------------------------------------------ QR */}
          <aside className="flex flex-col items-center gap-3 md:w-52">
            {qrUrl && (
              <div className="rounded-lg border bg-white p-3">
                <QRCode value={qrUrl} size={160} />
              </div>
            )}
            <p className="text-center text-xs leading-relaxed text-gray-500">
              Scan to reopen this record.
              <br />
              Signing in is required.
            </p>
          </aside>
        </div>

        {/* ---------------------------------------------- the log */}
        <section className="border-t px-6 py-6">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-500">
            History
          </h2>
          <p className="mb-5 text-xs text-gray-400">
            Every step this bill took, in order. This log is append-only: entries
            cannot be edited or removed once written.
          </p>

          <ol className="relative space-y-6 border-l border-gray-200 pl-6">
            {events.map((e) => (
              <li key={e.id} className="relative">
                <span
                  className={`absolute -left-[1.9rem] top-1.5 h-3 w-3 rounded-full ring-4 ring-white ${
                    ACTION_DOT[e.action] ?? "bg-gray-300"
                  }`}
                />
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-medium text-gray-900">
                    {e.action === "Forwarded" || e.action === "Registered" || e.action === "Notified"
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
                    <p className="mt-1.5 rounded border-l-2 border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                      {e.remark}
                    </p>
                  )}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
