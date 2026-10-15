import { describe, expect, it } from "vitest";
import { canCorrectBill, canReviewSnp, deskRemark, editPauseAllowanceLeft, editWindowLeft, editWindowPaused, inEditWindow, latestArrivalFirst, recordedBillDates } from "@/lib/bill-review";
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

describe("edit window and desk queues", () => {
  const now = Date.parse("2026-10-14T10:00:00Z");
  const soon = "2026-10-14T10:03:00Z", past = "2026-10-14T09:55:00Z";

  it("lets the filer correct only within the window, after a hold at the current desk, or after rejection", () => {
    expect(inEditWindow(bill({ editable_until: soon }), now)).toBe(true);
    expect(canCorrectBill(bill({ editable_until: soon }), now)).toBe(true);
    expect(canCorrectBill(bill({ editable_until: past }), now)).toBe(false);
    expect(canCorrectBill(bill({ editable_until: null }), now)).toBe(false);
    expect(canCorrectBill(bill({ editable_until: past, snp: "Hold" }), now)).toBe(true);
    expect(canCorrectBill(bill({ status: "Finance Admin", snp: "Hold", finance_admin: "Pending" }), now)).toBe(false);
    expect(canCorrectBill(bill({ status: "Rejected", snp: "Reject", editable_until: past }), now)).toBe(true);
    expect(canCorrectBill(bill({ status: "Accepted", editable_until: soon }), now)).toBe(false);
  });

  it("stops counting down while the correction form holds the window open", () => {
    const paused = bill({ editable_until: "2026-10-14T10:08:00Z", edit_paused_until: "2026-10-14T10:03:00Z", edit_paused_seconds: 300 });
    expect(editWindowPaused(paused, now)).toBe(true);
    expect(editWindowLeft(paused, now)).toBe(300_000);
    expect(editWindowLeft(paused, now + 60_000)).toBe(300_000);
    // The lease lapsed: the clock runs again towards editable_until.
    expect(editWindowPaused(paused, now + 4 * 60_000)).toBe(false);
    expect(editWindowLeft(paused, now + 4 * 60_000)).toBe(4 * 60_000);
    expect(editWindowLeft(bill({ editable_until: soon }), now)).toBe(3 * 60_000);
  });

  it("tracks the 30 minutes of pausing a bill may use", () => {
    const paused = bill({ editable_until: "2026-10-14T10:08:00Z", edit_paused_until: "2026-10-14T10:03:00Z",
      edit_paused_seconds: 300, edit_paused_since: "2026-10-14T09:58:00Z", edit_pause_used_seconds: 600 });
    expect(editPauseAllowanceLeft(paused, now)).toBe(18 * 60_000);
    expect(editPauseAllowanceLeft(bill({ editable_until: soon, edit_pause_used_seconds: 1800 }), now)).toBe(0);
    expect(editPauseAllowanceLeft(bill({ editable_until: soon }), now)).toBe(30 * 60_000);
  });

  it("hides review actions from the desk while the filer can still change the bill", () => {
    expect(canReviewSnp(bill({ editable_until: new Date(Date.now() + 60_000).toISOString() }), "TEST-S", "SNP")).toBe(false);
  });

  it("puts the most recent arrival at a desk first, counting the edit window as arrival", () => {
    const old = bill({ id: "old", created_at: "2026-10-01T00:00:00Z", stage_entered_at: "2026-10-14T09:00:00Z" });
    const fresh = bill({ id: "fresh", created_at: "2026-10-13T00:00:00Z", stage_entered_at: "2026-10-13T00:00:00Z", editable_until: "2026-10-14T09:30:00Z" });
    const earlier = bill({ id: "earlier", created_at: "2026-10-12T00:00:00Z", stage_entered_at: "2026-10-12T00:00:00Z" });
    expect([earlier, old, fresh].sort(latestArrivalFirst).map((b) => b.id)).toEqual(["fresh", "old", "earlier"]);
  });

  it("shows the remark of the desk that held or rejected the bill", () => {
    expect(deskRemark(bill({ snp: "Approved", audit: "Hold", remarks1: "ok", remarks2: "Missing invoice copy" }))).toBe("Missing invoice copy");
    expect(deskRemark(bill({ status: "Rejected", snp: "Reject", remarks1: "Duplicate" }))).toBe("Duplicate");
    expect(deskRemark(bill())).toBeNull();
  });
});
