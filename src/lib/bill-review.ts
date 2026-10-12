import type { Bill } from "@/types/database";
import { normaliseRole } from "./roles";

export function canReviewSnp(bill: Bill, code: string | null | undefined, role: string | null | undefined) {
  return Boolean(code && normaliseRole(role) === "Student Purchase" && bill.status === "Student Purchase"
    && (bill.snp === "Pending" || bill.snp === "Hold") && code !== bill.employee_id && code !== bill.created_by);
}

function isoDay(value: string | null | undefined): string | null {
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
