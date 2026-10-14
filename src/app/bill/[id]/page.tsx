"use client";

import { deskLabel } from "@/lib/roles";
import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import QRCode from "react-qr-code";
import BillItems from "@/components/BillItems";
import SnpReviewPanel from "@/components/SnpReviewPanel";
import DeskReviewPanel from "@/components/DeskReviewPanel";
import { canReviewDesk } from "@/lib/bill-review";
import { billCorrections, type Revision } from "@/lib/bill-changes";
import AppShell, { sharedLinks } from "@/components/AppShell";
import { LoadingState, StatusBadge } from "@/components/ui/page";
import { api, dateOnly, money, when } from "@/lib/api";
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
  revisions: Revision[];
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
      return "text-slate-600 bg-slate-100";
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
      return "bg-slate-300";
  }
};

export default function BillDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session, status: authStatus } = useSession();

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
      <AppShell desk="Bill details" nav={[]} links={sharedLinks(session?.user?.employee_type, "detail")}><LoadingState label="Loading bill details…" /></AppShell>
    );

  if (error || !payload?.bill)
    return (
      <AppShell desk="Bill details" nav={[]} links={sharedLinks(session?.user?.employee_type, "detail")}>
        <div role="alert" className="mx-auto max-w-md rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-center text-sm text-red-800">
          {error ?? "Bill not found."}
        </div>
      </AppShell>
    );

  const { bill, events, register, applicant, route, revisions } = payload;
  const corrections = billCorrections(revisions);

  // helper for pretty formatting
  const formatValue = (val: string | number | boolean | null | undefined) => {
    if (val === null || val === undefined || val === "NULL") return "—";
    if (typeof val === "boolean") return val ? "Yes" : "No";
    if (typeof val === "string" && val.trim() === "") return "—";
    return val;
  };

  return (
    <AppShell desk="Bill details" nav={[]} links={sharedLinks(session?.user?.employee_type, "detail")}>
    <div className="mx-auto max-w-4xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:border-0 print:shadow-none">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <button onClick={() => history.length > 1 ? history.back() : window.location.assign("/")} className="mb-2 text-sm font-medium text-blue-700 hover:underline print:hidden">
            ← Back
          </button>
          <h1 className="text-2xl font-semibold text-slate-900">Bill details</h1>
          {bill.bill_number && (
            <p className="mt-1 font-mono text-sm text-slate-500">{bill.bill_number}</p>
          )}
        </div>
        <a
          href={`/bill/${bill.id}/print`}
          className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 print:hidden"
        >
          Print bill
        </a>
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
            : `With ${deskLabel(bill.status)}`}
        </span>
        {register && (
          <span className="px-3 py-1 rounded-full text-sm bg-blue-50 text-blue-700 border border-blue-200">
            Register entry <strong>{register.serial_no}</strong>
          </span>
        )}
        <span className="text-sm text-slate-500">
          Filed {when(bill.created_at)}
          {bill.decided_at && ` · decided ${when(bill.decided_at)}`}
        </span>
      </div>

      <BillItems bill={bill} />
      <div className="my-6">
        <SnpReviewPanel key={`${bill.id}:${bill.revision}`} bill={bill} actorCode={session?.user?.employee_code}
          actorRole={session?.user?.employee_type} onDecided={async (updated) => {
            setPayload((current) => current ? { ...current, bill: updated } : current);
            const { data, error: refreshError } = await api.get<Payload>(`/api/bills/${id}`);
            if (refreshError) setError(refreshError); else setPayload(data);
          }} />
        {(["Audit", "Finance Admin"] as const).map((desk) =>
          canReviewDesk(bill, desk, session?.user?.employee_code, session?.user?.employee_type) ? (
            <div key={desk} className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h2 className="mb-3 text-base font-semibold text-slate-900">{desk} decision</h2>
              <DeskReviewPanel key={`${bill.id}:${bill.revision}`} bill={bill} desk={desk}
                actorCode={session?.user?.employee_code} actorRole={session?.user?.employee_type}
                onDecided={async (updated) => {
                  setPayload((current) => current ? { ...current, bill: updated } : current);
                  const { data, error: refreshError } = await api.get<Payload>(`/api/bills/${id}`);
                  if (refreshError) setError(refreshError); else setPayload(data);
                }} />
            </div>
          ) : null
        )}
      </div>
      <section className="mb-6 rounded-xl border border-slate-200 p-4" aria-label="Changes">
        <h2 className="text-base font-semibold text-slate-900">Changes</h2>
        {corrections.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">No corrections since this bill was filed.</p>
        ) : (
          <>
          <p className="mb-3 text-xs text-slate-500">Corrections made to this bill after it was filed. Decisions are in the History below.</p>
          <ol className="space-y-3">
            {corrections.map((c, i) => (
              <li key={i} className="rounded-lg bg-slate-50 p-3 text-sm">
                <p className="font-medium text-slate-900">
                  Corrected by {c.actor} <span className="font-normal text-slate-500">· {when(c.at)}</span>
                </p>
                <ul className="mt-1 space-y-0.5">
                  {c.changes.map((ch) => (
                    <li key={ch.label} className="text-slate-700">
                      <span className="text-slate-500">{ch.label}:</span>{" "}
                      <span className="line-through decoration-slate-400">{ch.from}</span>{" "}→{" "}
                      <span className="font-medium text-slate-900">{ch.to}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          </>
        )}
      </section>
      {/* Approval route */}
      <div className="mb-6 print:hidden">
        <p className="text-sm font-medium text-slate-700 mb-2">
          Approval route for a {bill.item_category?.toLowerCase()} purchase of{" "}
          {money(bill.po_value)}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="px-2.5 py-1 rounded bg-slate-100 text-slate-600">Filed</span>
          {route.map((stop) => {
            const passed =
              events.some((e) => e.stage === stop && e.action === "Approved" && e.seq >
                Math.max(0, ...events.filter((event) => event.stage === "Applicant" && event.action === "Forwarded").map((event) => event.seq)));
            const here = bill.status === stop;
            const rejectedHere = events.some(
              (e) => e.stage === stop && e.action === "Rejected"
            );
            return (
              <React.Fragment key={deskLabel(stop)}>
                <svg className="h-4 w-4 shrink-0 text-slate-300" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {deskLabel(stop)}
                </span>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Details, grouped the way the print sheet groups them */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {([
          ["Applicant", [
            ["Name", applicant?.employee_name ?? bill.employee_name],
            ["Employee ID", bill.employee_id],
            ["Department", bill.employee_department],
            ["Email", applicant?.email],
            ["Filed", when(bill.created_at)],
          ]],
          ["Supplier and invoice", [
            ["Supplier", bill.supplier_name],
            ["Address", bill.supplier_address],
            ["Invoice", bill.invoice_no ? `${bill.invoice_no} · ${dateOnly(bill.invoice_date)}` : null],
            ["PO", bill.po_details],
            ["Delivered / installed", `${dateOnly(bill.date_of_delivery)} / ${bill.date_of_installation ? dateOnly(bill.date_of_installation) : "Not required"}`],
          ]],
          ["Funding and stock", [
            ["Amount", money(bill.po_value)],
            ["Source of fund", bill.source_of_fund],
            ["Charged to", bill.funding_pool && bill.funding_pool !== "PDA" ? `Institute ${bill.funding_pool} budget, ${bill.funding_fy}` : `PDA of ${bill.employee_id}`],
            ["Category", bill.item_category],
            ["Quantity / issued", `${bill.qty ?? "—"} / ${bill.qty_issued ?? "—"}`],
            ["Stock entry", bill.stock_entry],
            ["Location", bill.location],
          ]],
        ] as const).map(([heading, rows]) => (
          <section key={heading} aria-label={heading} className="rounded-xl border border-slate-200 p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">{heading}</h2>
            <dl className="space-y-1.5 text-sm">
              {rows.map(([label, value]) => (
                <div key={label} className="grid grid-cols-[9rem_1fr] gap-2">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="break-words text-slate-900">{formatValue(value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <section aria-label="Desk decisions" className="rounded-xl border border-slate-200 p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Desk decisions</h2>
          <dl className="space-y-1.5 text-sm">
            {([["Store and Purchase", bill.snp], ["Audit", bill.audit], ["Finance Admin", bill.finance_admin]] as const).map(([desk, state]) => (
              <div key={desk} className="grid grid-cols-[9rem_1fr] items-center gap-2">
                <dt className="text-slate-500">{desk}</dt>
                <dd>{state ? <StatusBadge value={state} /> : <span className="text-slate-500">Not on this bill&apos;s route</span>}</dd>
              </div>
            ))}
            {bill.has_bank_guarantee && (
              <div className="grid grid-cols-[9rem_1fr] gap-2">
                <dt className="text-slate-500">Bank guarantee</dt>
                <dd className="text-slate-900">{money(bill.bank_guarantee_amount)} · {formatValue(bill.bank_guarantee_details)}</dd>
              </div>
            )}
          </dl>
        </section>
      </div>

      {/* Register entry */}
      {register && (
        <>
          <h3 className="text-lg font-semibold text-slate-800 mt-8 mb-3">
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
            <p className="text-xs text-slate-500 mt-3 pt-3 border-t border-blue-200">
              This purchase is recorded permanently in the {register.department} register.
              Register entries cannot be edited or deleted.
            </p>
          </div>
        </>
      )}

      {/* History */}
      <h3 className="text-lg font-semibold text-slate-800 mt-8 mb-1">History</h3>
      <p className="text-xs text-slate-500 mb-5">
        Every step this bill took, in order. This log is append-only — entries cannot be
        edited or removed once written.
      </p>

      <ol className="relative space-y-6 border-l border-slate-200 pl-6 ml-2">
        {events.map((e) => (
          <li key={e.id} className="relative">
            <span
              className={`absolute -left-[1.85rem] top-1.5 h-3 w-3 rounded-full ring-4 ring-white ${dotColor(
                e.action
              )}`}
            />
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-medium text-slate-900 text-sm">
                {e.action === "Forwarded" ||
                e.action === "Registered" ||
                e.action === "Notified"
                  ? deskLabel(e.remark)
                  : `${deskLabel(e.stage)} — ${e.action}`}
              </span>
              <span className="text-xs text-slate-500">{when(e.created_at)}</span>
            </div>

            {e.actor_name && (
              <p className="mt-0.5 text-sm text-slate-500">
                {e.actor_name}
                {e.actor_code ? ` (${e.actor_code})` : ""}
                {e.actor_role ? ` · ${deskLabel(e.actor_role)}` : ""}
              </p>
            )}

            {e.remark &&
              e.action !== "Forwarded" &&
              e.action !== "Registered" &&
              e.action !== "Notified" && (
                <p className="mt-1.5 bg-slate-50 border-l-2 border-slate-200 px-3 py-2 text-sm text-slate-700 rounded-r">
                  {deskLabel(e.remark)}
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
        <p className="text-xs text-slate-500 text-center">
          Scan to reopen this record. Signing in is required.
        </p>
      </div>
    </div>
    </AppShell>
  );
}
