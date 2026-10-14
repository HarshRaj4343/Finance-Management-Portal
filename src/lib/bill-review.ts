import type { Bill } from "@/types/database";
import { normaliseRole } from "./roles";

/** Mirrors fn_edit_window in 0006_edit_window.sql. The database enforces it. */
export const EDIT_WINDOW_MINUTES = 5;

type WindowBill = Pick<Bill, "status" | "editable_until">;
type DeskBill = Pick<Bill, "status" | "snp" | "audit" | "finance_admin">;

/** Freshly filed or corrected: only the filer sees and may change it. */
export function inEditWindow(bill: WindowBill, now = Date.now()): boolean {
  if (!bill.editable_until || bill.status === "Accepted" || bill.status === "Rejected") return false;
  return Date.parse(bill.editable_until) > now;
}

/** Milliseconds left in the edit window, or 0. */
export function editWindowLeft(bill: WindowBill, now = Date.now()): number {
  return inEditWindow(bill, now) ? Date.parse(bill.editable_until!) - now : 0;
}

/** The desk the bill is sitting at has put it on hold. */
export function heldAtCurrentDesk(bill: DeskBill): boolean {
  return (bill.status === "Student Purchase" && bill.snp === "Hold")
    || (bill.status === "Audit" && bill.audit === "Hold")
    || (bill.status === "Finance Admin" && bill.finance_admin === "Hold");
}

/** Mirrors the states fn_amend_bill accepts. */
export function canCorrectBill(bill: WindowBill & DeskBill, now = Date.now()): boolean {
  return bill.status !== "Accepted" && (inEditWindow(bill, now) || bill.status === "Rejected" || heldAtCurrentDesk(bill));
}

/** The remark explaining the current hold or the rejection, if any. */
export function deskRemark(bill: Bill): string | null {
  if (bill.finance_admin === "Hold" || bill.finance_admin === "Reject") return bill.remarks;
  if (bill.audit === "Hold" || bill.audit === "Reject") return bill.remarks2;
  if (bill.snp === "Hold" || bill.snp === "Reject") return bill.remarks1;
  return null;
}

/** When the bill reached the desk it is at now; a desk sees it only after the edit window. */
export function arrivedAt(bill: Pick<Bill, "stage_entered_at" | "editable_until" | "updated_at" | "created_at">): number {
  const times = [bill.stage_entered_at, bill.editable_until].map((t) => (t ? Date.parse(t) : NaN)).filter(Number.isFinite);
  return times.length ? Math.max(...times) : Date.parse(bill.updated_at ?? bill.created_at) || 0;
}

/** Queue order: the bill that most recently arrived at the desk comes first. */
export const latestArrivalFirst = (a: Bill, b: Bill) => arrivedAt(b) - arrivedAt(a);

export function canReviewSnp(bill: Bill, code: string | null | undefined, role: string | null | undefined) {
  return Boolean(code && normaliseRole(role) === "Student Purchase" && bill.status === "Student Purchase"
    && (bill.snp === "Pending" || bill.snp === "Hold") && code !== bill.employee_id && code !== bill.created_by
    && !inEditWindow(bill));
}

/** Audit or Finance Admin may decide this bill now: right desk, still open, not their own, window closed. */
export function canReviewDesk(bill: Bill, desk: "Audit" | "Finance Admin", code: string | null | undefined, role: string | null | undefined) {
  const state = desk === "Audit" ? bill.audit : bill.finance_admin;
  return Boolean(code && normaliseRole(role) === desk && bill.status === desk
    && (state === "Pending" || state === "Hold" || state == null)
    && code !== bill.employee_id && code !== bill.created_by && !inEditWindow(bill));
}

/** A calendar day in India, YYYY-MM-DD. */
export function isoDay(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

/** Strict fallback for the old form's generated text, not an arbitrary date guess or database backfill. */
function legacyDay(text: string | null, label: string) {
  const matches = [...(text ?? "").matchAll(new RegExp(`\\b${label} (\\d{2}) ([A-Za-z]{3,4}) (\\d{4})(?=[.\\s]|$)`, "g"))];
  if (matches.length !== 1) return null;
  const [, day, name, year] = matches[0];
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const month = months.indexOf(name.toLowerCase().slice(0, 3)) + 1;
  if (!month) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${day}`;
  const parsed = new Date(iso);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

export function recordedBillDates(bill: Bill) {
  const delivery = isoDay(bill.date_of_delivery) ?? isoDay(bill.form_data?.deliveryDate);
  const installation = isoDay(bill.date_of_installation) ?? (bill.form_data?.installRequired === "yes" ? isoDay(bill.form_data.installDate) : null);
  return {
    delivery: delivery ?? legacyDay(bill.bill_details, "Delivered"),
    installation: installation ?? legacyDay(bill.bill_details, "Installed"),
    legacy: Boolean((!delivery && legacyDay(bill.bill_details, "Delivered")) || (!installation && legacyDay(bill.bill_details, "Installed"))),
    installationNotRequired: bill.form_data?.installRequired === "no" || /\bNo installation required\b/.test(bill.bill_details ?? ""),
  };
}
