import { money } from "./api";
import { istDay } from "./bill-review";
import { shortDate } from "@/app/apply-bill/bill-form/model";

/** One stored before/after pair from change_log. */
export type Revision = {
  actor_code: string | null;
  actor_name?: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown>;
  recorded_at: string;
};

export type Correction = {
  actor: string;
  at: string;
  changes: { label: string; from: string; to: string }[];
};

type Kind = "text" | "money" | "date" | "number";

/** The bill content a filer can correct. Workflow columns are on the History timeline instead. */
const FIELDS: [key: string, label: string, kind: Kind][] = [
  ["po_value", "Amount", "money"],
  ["item_category", "Category", "text"],
  ["item_description", "Items", "text"],
  ["qty", "Quantity", "number"],
  ["qty_issued", "Quantity issued", "number"],
  ["supplier_name", "Supplier", "text"],
  ["supplier_address", "Supplier address", "text"],
  ["invoice_no", "Invoice number", "text"],
  ["invoice_date", "Invoice date", "date"],
  ["po_details", "PO details", "text"],
  ["source_of_fund", "Source of fund", "text"],
  ["location", "Location", "text"],
  ["date_of_delivery", "Delivery date", "date"],
  ["date_of_installation", "Installation date", "date"],
];

function show(value: unknown, kind: Kind): string {
  if (value === null || value === undefined || value === "") return "—";
  if (kind === "money") return money(Number(value));
  if (kind === "date") {
    const day = istDay(String(value));
    return day ? shortDate(day) : String(value);
  }
  return String(value).trim();
}

/**
 * Corrections in plain words: for each change_log entry that altered the
 * bill's content, the fields that changed with their old and new values.
 * Creation and pure workflow updates (approvals, holds) are left out.
 */
export function billCorrections(revisions: Revision[]): Correction[] {
  const out: Correction[] = [];
  for (const r of revisions) {
    if (!r.old_data) continue;
    const changes = FIELDS.flatMap(([key, label, kind]) => {
      const from = show(r.old_data![key], kind);
      const to = show(r.new_data[key], kind);
      return from === to ? [] : [{ label, from, to }];
    });
    if (changes.length) {
      out.push({ actor: r.actor_name || r.actor_code || "System", at: r.recorded_at, changes });
    }
  }
  return out;
}
