import "server-only";
import { emptyForm, emptyLine, validateStep, toPayload, toNum, type FormState } from "@/app/apply-bill/bill-form/model";
import { UOMS } from "@/app/apply-bill/bill-form/masters";
import { HttpError, type Actor } from "./session";
import { isUmbrellaDepartment } from "@/lib/roles";
import { isMoney } from "@/lib/security";

export function assertBillWriter(actor: Actor, employeeCode: string, department: string | null, edit = false) {
  const own = actor.role === "User" && actor.code === employeeCode;
  const clerk = (actor.role === "Bill Employee" || (edit && actor.role === "Bill Editor")) &&
    (isUmbrellaDepartment(actor.department) || Boolean(actor.department && actor.department === department));
  if (!own && !clerk) throw new HttpError(403, "Only the applicant or the authorised departmental filing/editor desk can change this bill.");
}

/** Shape-check before shared validation; never trust a browser's flattened amount. */
export function validateBillForm(value: unknown): FormState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "The complete bill form is required.");
  // Other charges were removed from the form: unit prices now include them.
  // Drop the key from older drafts and bills so the database never adds it.
  const { otherCharges: _legacyCharges, ...raw } = value as Record<string, unknown>;
  void _legacyCharges;
  for (const [key, template] of Object.entries(emptyForm())) {
    if (key !== "lines" && (typeof raw[key] !== typeof template || (typeof raw[key] === "string" && raw[key].length > 2000))) throw new HttpError(400, `Invalid bill field: ${key}.`);
  }
  if (!Array.isArray(raw.lines) || raw.lines.length < 1 || raw.lines.length > 100) throw new HttpError(400, "Enter between 1 and 100 items.");
  for (const line of raw.lines) {
    if (!line || typeof line !== "object") throw new HttpError(400, "Invalid item.");
    for (const [key, template] of Object.entries(emptyLine())) {
      if (typeof line[key] !== typeof template || (typeof line[key] === "string" && line[key].length > 2000)) throw new HttpError(400, `Invalid item field: ${key}.`);
    }
    if (!(UOMS as readonly string[]).includes(line.uom)) throw new HttpError(400, "Choose a recognised unit.");
  }
  const form = raw as unknown as FormState;
  if (!["po", "direct"].includes(form.purchaseType) || form.delivered !== "yes" || !["yes", "no"].includes(form.installRequired) || (form.installRequired === "yes" && form.installDone !== "yes")) throw new HttpError(400, "Goods must be delivered and any required installation completed.");
  for (const date of [form.billDate, form.deliveryDate, ...(form.purchaseType === "po" ? [form.poDate] : []), ...(form.installRequired === "yes" ? [form.installDate] : [])]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new HttpError(400, "Enter valid calendar dates.");
  }
  for (const amount of [form.poValue, ...form.lines.map((line) => line.unitPrice)]) {
    const number = toNum(amount);
    if (!isMoney(number)) throw new HttpError(400, "Amounts must be finite, within range, and have at most two decimal places.");
  }
  for (let step = 0; step < 6; step++) {
    const errors = validateStep(step, form, { requesterFound: true, requesterDepartment: null, filingDepartment: null });
    if (Object.values(errors)[0]) throw new HttpError(400, Object.values(errors)[0]);
  }
  if (toPayload(form).po_value >= 1e10) throw new HttpError(400, "The bill total is too large.");
  return form;
}

export function billPayload(value: unknown) {
  const form = validateBillForm(value);
  return { ...toPayload(form), form_data: form, invoice_no: form.billNo.trim(), invoice_date: form.billDate,
    date_of_delivery: form.deliveryDate, date_of_installation: form.installRequired === "yes" ? form.installDate : null };
}
