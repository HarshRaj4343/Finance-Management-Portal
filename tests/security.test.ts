import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/session", () => ({ HttpError: class extends Error { constructor(public status: number, message: string) { super(message); } } }));
import { safeCallbackPath, escapeHtml, pagination, isMoney } from "@/lib/security";
import { assertBillWriter, billPayload, validateBillForm } from "@/server/bill-validation";
import { ITEM_GROUPS, typesForGroup } from "@/app/apply-bill/bill-form/masters";
import { billForm } from "./fixtures";

describe("request boundary validation", () => {
  it("rejects external, backslash and control-character redirects", () => {
    for (const path of ["//example.com", "/\\example.com", "https://example.com", "/\nexample.com"]) expect(safeCallbackPath(path)).toBeNull();
    expect(safeCallbackPath("/bill/123?x=1")).toBe("/bill/123?x=1");
  });
  it("escapes every HTML metacharacter used by printed bill fields", () => {
    expect(escapeHtml('<script>"x" & \'y\'</script>')).toBe("&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;");
  });
  it("clamps invalid pagination and preserves zero offset", () => {
    expect(pagination(new URLSearchParams("limit=-1&offset=NaN"))).toEqual({ limit: 100, offset: 0 });
    expect(pagination(new URLSearchParams("limit=9999&offset=1.5"))).toEqual({ limit: 500, offset: 0 });
  });
  it("accepts cents without silently rounding allocations", () => {
    for (const value of [0, 1.01, 9999999999.99]) expect(isMoney(value)).toBe(true);
    for (const value of [-1, 1.001, NaN, Infinity, 1e10]) expect(isMoney(value)).toBe(false);
  });
  it("derives amount from items, preserves structured detail, and validates declarations", () => {
    const f = billForm();
    expect(billPayload(f)).toMatchObject({ po_value: 1000, invoice_no: f.billNo, form_data: f });
    f.declaration = false;
    expect(() => validateBillForm(f)).toThrow(/declaration/);
  });
  it("rejects bad shapes, amounts, dates, quantities and incomplete delivery", () => {
    for (const change of [
      (f: ReturnType<typeof billForm>) => { f.lines = []; },
      (f: ReturnType<typeof billForm>) => { f.lines[0].unitPrice = "Infinity"; },
      (f: ReturnType<typeof billForm>) => { f.poValue = "NaN"; },
      (f: ReturnType<typeof billForm>) => { f.billDate = "2026-02-30"; },
      (f: ReturnType<typeof billForm>) => { f.lines[0].qtyIssued = "99"; },
      (f: ReturnType<typeof billForm>) => { f.delivered = "no"; },
      (f: ReturnType<typeof billForm>) => { f.lines[0].unitPrice = "1.001"; },
    ]) { const f = billForm(); change(f); expect(() => validateBillForm(f)).toThrow(); }
  });
  it("limits clerks to their department, while keeping the umbrella desk", () => {
    const a = { code: "C", name: "Clerk", email: null, provisioned: true, department: "A", role: "Bill Employee" as const };
    expect(() => assertBillWriter(a, "U", "B")).toThrow();
    expect(() => assertBillWriter(a, "U", "A")).not.toThrow();
    expect(() => assertBillWriter({ ...a, department: "Store and Purchase Section" }, "U", "B")).not.toThrow();
    expect(() => assertBillWriter({ ...a, role: "Finance Admin" }, "U", "A")).toThrow();
    expect(() => assertBillWriter({ ...a, role: "Bill Editor" }, "U", "A", true)).not.toThrow();
  });
  it("provides at least one usable item type for every item group", () => {
    for (const group of ITEM_GROUPS) expect(typesForGroup(group).length).toBeGreaterThan(0);
  });
});
