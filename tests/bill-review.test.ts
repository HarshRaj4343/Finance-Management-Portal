import { describe, expect, it } from "vitest";
import { canReviewSnp, recordedBillDates } from "@/lib/bill-review";
import type { Bill } from "@/types/database";
import { billForm } from "./fixtures";

const bill = (fields: Partial<Bill> = {}) => ({
  id: "test", employee_id: "TEST-U", created_by: "TEST-C", status: "Student Purchase", snp: "Pending",
  date_of_delivery: null, date_of_installation: null, form_data: null, bill_details: null, ...fields,
} as Bill);

describe("shared Store and Purchase review", () => {
  it("shows actions only at the correct desk and never to the applicant or original filer", () => {
    expect(canReviewSnp(bill(), "TEST-S", "SNP")).toBe(true);
    expect(canReviewSnp(bill({ snp: "Hold" }), "TEST-S", "Student Purchase")).toBe(true);
    for (const [code, role] of [["TEST-U", "SNP"], ["TEST-C", "SNP"], ["TEST-A", "Audit"], [null, "SNP"]]) {
      expect(canReviewSnp(bill(), code, role)).toBe(false);
    }
    expect(canReviewSnp(bill({ status: "Finance Admin", snp: "Approved" }), "TEST-S", "SNP")).toBe(false);
    expect(canReviewSnp(bill({ status: "Accepted" }), "TEST-S", "SNP")).toBe(false);
  });
  it("uses filed delivery and installation dates independently of bank guarantees", () => {
    const f = billForm(); f.installRequired = "yes"; f.installDate = "2026-01-03";
    expect(recordedBillDates(bill({ form_data: f, has_bank_guarantee: false }))).toEqual({
      delivery: "2026-01-02", installation: "2026-01-03", installationNotRequired: false, legacy: false,
    });
    expect(recordedBillDates(bill({ form_data: billForm() })).installationNotRequired).toBe(true);
    expect(recordedBillDates(bill({ form_data: f, date_of_delivery: "2026-01-04", date_of_installation: "2026-01-05" }))).toMatchObject({ delivery: "2026-01-04", installation: "2026-01-05" });
  });
  it("normalises timestamp dates to IST", () => {
    expect(recordedBillDates(bill({ date_of_delivery: "2026-01-01T18:30:00.000Z" })).delivery).toBe("2026-01-02");
  });
  it("reads only unambiguous generated legacy text and does not invent missing dates", () => {
    expect(recordedBillDates(bill({ bill_details: "Delivered 03 Sept 2026. No installation required." }))).toEqual({ delivery: "2026-09-03", installation: null, legacy: true, installationNotRequired: true });
    expect(recordedBillDates(bill({ bill_details: "Delivered 03 Sep 2026. Installed 04 Sep 2026." }))).toMatchObject({ installation: "2026-09-04", legacy: true });
    for (const text of ["No date recorded", "Delivered 31 Feb 2026.", "Delivered 03 Sep 2026. Delivered 04 Sep 2026."]) {
      expect(recordedBillDates(bill({ bill_details: text })).delivery).toBeNull();
    }
  });
});
