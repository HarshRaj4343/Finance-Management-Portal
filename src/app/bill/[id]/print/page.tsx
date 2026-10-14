"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import QRCode from "react-qr-code";
import { api, money, when } from "@/lib/api";
import { deskLabel } from "@/lib/roles";
import { amountInWords } from "@/lib/amount-words";
import { istDay } from "@/lib/bill-review";
import { lineTotal, placeLabel, shortDate } from "@/app/apply-bill/bill-form/model";
import { FUNDS } from "@/app/apply-bill/bill-form/masters";
import type { Bill, BillApproval, Employee, RegisterEntry } from "@/types/database";

type Payload = {
  bill: Bill;
  events: BillApproval[];
  register: RegisterEntry | null;
  applicant: Pick<Employee, "employee_code" | "employee_name" | "email" | "department"> | null;
  route: string[];
  error?: string;
};

const DESKS = ["Student Purchase", "Audit", "Finance Admin"];
const day = (v: string | null | undefined) => { const d = istDay(v); return d ? shortDate(d) : "—"; };
const STATUS_TEXT: Record<string, string> = { Accepted: "Approved — entered in the purchase register", Rejected: "Rejected" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9.5rem_1fr] gap-2 py-0.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{children || "—"}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 break-inside-avoid">
      <h2 className="mb-2 border-b border-slate-300 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-700">{title}</h2>
      {children}
    </section>
  );
}

/**
 * A4 print layout of one bill: institute header, bill and supplier details,
 * the item table with the total in words, the complete approval record and
 * signature blocks for every desk on its route. Open with ?print=1 to send it
 * straight to the printer.
 */
export default function PrintBillPage() {
  const { id } = useParams<{ id: string }>();
  const { status } = useSession();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => {
    if (status === "unauthenticated") { window.location.href = `/login?callbackUrl=${encodeURIComponent(`/bill/${id}/print`)}`; return; }
    if (status !== "authenticated") return;
    api.get<Payload>(`/api/bills/${id}`).then(({ data, error: err }) => {
      if (err || !data?.bill) setError(err ?? "Bill not found."); else setPayload(data);
    });
  }, [id, status]);
  // Print once the sheet and its QR code have rendered.
  useEffect(() => {
    if (!payload || new URLSearchParams(window.location.search).get("print") !== "1") return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [payload]);

  if (error) return <p role="alert" className="mx-auto mt-10 max-w-md rounded-lg border border-red-200 bg-red-50 p-4 text-center text-sm text-red-800">{error}</p>;
  if (!payload) return <p className="mt-10 text-center text-sm text-slate-500">Preparing the bill for printing…</p>;

  const { bill, events, register, applicant, route } = payload;
  const lines = bill.form_data?.lines ?? [];
  const fund = FUNDS.find((f) => f.code === bill.source_of_fund);
  const filed = events.find((e) => e.stage === "Applicant" && e.action === "Submitted");
  const record = events.filter((e) => e.stage !== "System" && e.action !== "Notified");
  const lastDecision = (desk: string) => [...events].reverse().find((e) => e.stage === desk && ["Approved", "Hold", "Rejected"].includes(e.action));
  const printedAt = when(new Date().toISOString());

  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <style>{"@page { size: A4; margin: 12mm; } @media print { html, body { background: #fff; } }"}</style>

      <div className="mx-auto mb-4 flex max-w-[210mm] items-center justify-between px-2 print:hidden">
        <button onClick={() => (history.length > 1 ? history.back() : window.location.assign(`/bill/${id}`))}
          className="text-sm font-medium text-blue-700 hover:underline">← Back</button>
        <button onClick={() => window.print()}
          className="inline-flex h-9 items-center rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800">
          Print / Save as PDF
        </button>
      </div>

      <article className="mx-auto max-w-[210mm] bg-white p-[12mm] text-[12px] leading-snug text-slate-900 shadow print:max-w-none print:p-0 print:shadow-none">
        {/* Header */}
        <header className="flex items-start justify-between gap-4 border-b-2 border-slate-800 pb-3">
          <div className="flex items-center gap-3">
            <Image src="/iit.png" alt="IIT Mandi" width={64} height={51} className="h-auto w-16" />
            <div>
              <p className="text-base font-bold">Indian Institute of Technology Mandi</p>
              <p className="text-slate-600">Kamand, Mandi, Himachal Pradesh 175075</p>
              <p className="mt-1 text-[13px] font-semibold uppercase tracking-wide">Bill Processing Sheet</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-mono text-sm font-bold">{bill.bill_number ?? "—"}</p>
            <p className="text-slate-600">Filed {day(bill.created_at)}</p>
            {origin && <div className="mt-1 inline-block bg-white p-1"><QRCode value={`${origin}/bill/${bill.id}`} size={64} /></div>}
          </div>
        </header>

        {/* Status strip */}
        <div className="mt-3 flex flex-wrap justify-between gap-2 rounded border border-slate-300 bg-slate-50 px-3 py-2">
          <span><span className="text-slate-500">Status:</span> <strong>{STATUS_TEXT[bill.status] ?? `With ${deskLabel(bill.status)}`}</strong></span>
          {register && <span><span className="text-slate-500">Register serial:</span> <strong className="font-mono">{register.serial_no}</strong></span>}
          <span><span className="text-slate-500">Stock entry:</span> <strong className="font-mono">{bill.stock_entry ?? "—"}</strong></span>
        </div>

        <div className="grid grid-cols-2 gap-x-8">
          <Section title="Applicant">
            <dl>
              <Row label="Name">{applicant?.employee_name ?? bill.employee_name}</Row>
              <Row label="Employee ID">{bill.employee_id}</Row>
              <Row label="Department">{bill.employee_department}</Row>
              <Row label="Email">{applicant?.email}</Row>
              <Row label="Filed by">{filed ? `${filed.actor_name ?? filed.actor_code} on ${when(filed.created_at)}` : null}</Row>
            </dl>
          </Section>
          <Section title="Supplier and invoice">
            <dl>
              <Row label="Supplier">{bill.supplier_name}</Row>
              <Row label="Address">{bill.supplier_address}</Row>
              <Row label="Invoice no. / date">{bill.invoice_no ? `${bill.invoice_no} · ${day(bill.invoice_date)}` : null}</Row>
              <Row label="PO">{bill.po_details}</Row>
              <Row label="Delivered / installed">{`${day(bill.date_of_delivery)} / ${bill.date_of_installation ? day(bill.date_of_installation) : "Not required"}`}</Row>
            </dl>
          </Section>
        </div>

        <Section title="Funding">
          <dl className="grid grid-cols-2 gap-x-8">
            <Row label="Source of fund">{fund ? `${fund.code} — ${fund.description}` : bill.source_of_fund}</Row>
            <Row label="Charged to">{bill.funding_pool && bill.funding_pool !== "PDA" ? `Institute ${bill.funding_pool} budget, ${bill.funding_fy}` : `PDA of ${bill.employee_id}`}</Row>
            <Row label="Category">{bill.item_category}</Row>
            {bill.has_bank_guarantee && <Row label="Bank guarantee">{`${money(bill.bank_guarantee_amount)} — ${bill.bank_guarantee_details ?? ""}`}</Row>}
          </dl>
        </Section>

        <Section title="Items">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="bg-slate-100 text-left">
                {["#", "Item", "Qty", "Unit price", "Amount", "Issued", "Custodian / location"].map((h) => (
                  <th scope="col" key={h} className={`border border-slate-300 px-2 py-1 font-semibold ${["Unit price", "Amount"].includes(h) ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.length ? lines.map((l, i) => (
                <tr key={i} className="break-inside-avoid">
                  <td className="border border-slate-300 px-2 py-1">{i + 1}</td>
                  <td className="border border-slate-300 px-2 py-1">
                    {l.description || l.type}
                    {(l.brand || l.model) && <span className="block text-slate-500">{[l.brand, l.model].filter(Boolean).join(" ")}</span>}
                  </td>
                  <td className="whitespace-nowrap border border-slate-300 px-2 py-1">{l.qty} {l.uom}</td>
                  <td className="whitespace-nowrap border border-slate-300 px-2 py-1 text-right">{money(String(l.unitPrice).replace(/[₹,\s]/g, ""))}</td>
                  <td className="whitespace-nowrap border border-slate-300 px-2 py-1 text-right">{money(lineTotal(l))}</td>
                  <td className="border border-slate-300 px-2 py-1">{l.qtyIssued}</td>
                  <td className="border border-slate-300 px-2 py-1">{l.custodian}{placeLabel(l) && <span className="block text-slate-500">{placeLabel(l)}</span>}</td>
                </tr>
              )) : (
                <tr>
                  <td className="border border-slate-300 px-2 py-1">1</td>
                  <td className="border border-slate-300 px-2 py-1">{bill.item_description}</td>
                  <td className="border border-slate-300 px-2 py-1">{bill.qty}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right">—</td>
                  <td className="border border-slate-300 px-2 py-1 text-right">{money(bill.po_value)}</td>
                  <td className="border border-slate-300 px-2 py-1">{bill.qty_issued ?? "—"}</td>
                  <td className="border border-slate-300 px-2 py-1">{bill.location}</td>
                </tr>
              )}
              <tr className="bg-slate-50 font-semibold">
                <td colSpan={4} className="border border-slate-300 px-2 py-1 text-right">Total</td>
                <td className="whitespace-nowrap border border-slate-300 px-2 py-1 text-right">{money(bill.po_value)}</td>
                <td colSpan={2} className="border border-slate-300 px-2 py-1" />
              </tr>
            </tbody>
          </table>
          <p className="mt-1"><span className="text-slate-500">Amount in words:</span> <strong>{amountInWords(bill.po_value)}</strong></p>
        </Section>

        <Section title="Approval record">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="bg-slate-100 text-left">
                {["Date and time", "Desk", "Action", "By", "Remarks"].map((h) => <th scope="col" key={h} className="border border-slate-300 px-2 py-1 font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {record.map((e) => (
                <tr key={e.id} className="break-inside-avoid">
                  <td className="whitespace-nowrap border border-slate-300 px-2 py-1">{when(e.created_at)}</td>
                  <td className="border border-slate-300 px-2 py-1">{e.stage === "Applicant" ? "Filer" : deskLabel(e.stage)}</td>
                  <td className="border border-slate-300 px-2 py-1">{e.action === "Forwarded" && e.stage === "Applicant" ? "Corrected / resubmitted" : e.action}</td>
                  <td className="border border-slate-300 px-2 py-1">{e.actor_name ?? e.actor_code ?? "—"}</td>
                  <td className="border border-slate-300 px-2 py-1">{e.stage === "Applicant" && e.action === "Submitted" ? "—" : e.remark || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {/* Signature blocks: one per desk on this bill's route */}
        <section className="mt-8 grid break-inside-avoid gap-4" style={{ gridTemplateColumns: `repeat(${route.filter((d) => DESKS.includes(d)).length + 1}, minmax(0, 1fr))` }}>
          <Signature title="Applicant" name={applicant?.employee_name ?? bill.employee_name} note={filed ? `Filed ${day(filed.created_at)}` : undefined} />
          {route.filter((d) => DESKS.includes(d)).map((desk) => {
            const d = lastDecision(desk);
            return <Signature key={desk} title={deskLabel(desk)} name={d?.actor_name ?? undefined}
              note={d ? `${d.action} ${day(d.created_at)}` : "Pending"} />;
          })}
        </section>

        <footer className="mt-8 border-t border-slate-300 pt-2 text-[10px] text-slate-500">
          Generated from the IIT Mandi Finance Portal on {printedAt}. Decisions above were recorded electronically by the named officers.
          Scan the QR code to verify this bill.
        </footer>
      </article>
    </div>
  );
}

function Signature({ title, name, note }: { title: string; name?: string | null; note?: string }) {
  return (
    <div className="text-center text-[11px]">
      <div className="mx-2 h-10 border-b border-slate-500" />
      <p className="mt-1 font-semibold">{title}</p>
      <p className="text-slate-700">{name ?? " "}</p>
      {note && <p className="text-slate-500">{note}</p>}
    </div>
  );
}
