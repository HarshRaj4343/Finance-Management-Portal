import { describe, expect, it } from "vitest";
import { billCorrections, type Revision } from "@/lib/bill-changes";

const base = { po_value: 4000, supplier_name: "A Traders", invoice_date: "2026-10-07", date_of_delivery: "2026-10-07T18:30:00+00:00",
  status: "Student Purchase", snp: "Pending", revision: 1 };
const rev = (old: Record<string, unknown> | null, next: Record<string, unknown>, extra: Partial<Revision> = {}): Revision =>
  ({ actor_code: "Bill-form", actor_name: "Demo Bill Filer", old_data: old, new_data: next, recorded_at: "2026-10-14T17:00:00Z", ...extra });

describe("readable bill changes", () => {
  it("lists only the corrected fields, in plain words, with who made them", () => {
    const corrected = { ...base, po_value: 5000, supplier_name: "B Traders", date_of_delivery: "2026-10-08T18:30:00+00:00", revision: 3 };
    const [c] = billCorrections([rev(null, base), rev(base, corrected)]);
    expect(c.actor).toBe("Demo Bill Filer");
    expect(c.changes).toEqual([
      { label: "Amount", from: "₹4,000.00", to: "₹5,000.00" },
      { label: "Supplier", from: "A Traders", to: "B Traders" },
      { label: "Delivery date", from: "08 Oct 2026", to: "09 Oct 2026" },
    ]);
  });

  it("ignores the filing itself and workflow-only updates such as approvals", () => {
    const approved = { ...base, status: "Finance Admin", snp: "Approved", revision: 2 };
    expect(billCorrections([rev(null, base), rev(base, approved, { actor_code: "SNP", actor_name: null })])).toEqual([]);
  });
});
