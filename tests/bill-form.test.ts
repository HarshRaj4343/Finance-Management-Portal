import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emptyForm, emptyLine, financialYear, inr, loadDraft, toNum, toPayload, totals, validateStep,
} from "../src/app/apply-bill/bill-form/model";
import { ITEM_TYPES, typesForGroup } from "../src/app/apply-bill/bill-form/masters";
import { deskLabel } from "@/lib/roles";

const ctx = { requesterFound: true, requesterDepartment: "SCEE", filingDepartment: "SCEE" };

function filled() {
  const f = emptyForm();
  Object.assign(f, {
    requesterCode: "E001", purchaseType: "po", poNumber: "PO/26/1", poDate: "2026-09-01",
    poValue: "100000", supplierName: "Acme", supplierAddress: "Mandi", billNo: "INV-9",
    billDate: "2026-09-10", fund: "OH-31", delivered: "yes", deliveryDate: "2026-09-05",
    installRequired: "yes", installDone: "yes", installDate: "2026-09-08",
    declaration: true, totalConfirmed: true,
  });
  const l = emptyLine();
  Object.assign(l, {
    group: "Computer & IT", type: "Laptop", brand: "Dell", model: "Latitude 5440",
    description: "Dell Latitude 5440", qty: "2", uom: "Nos", unitPrice: "40000", qtyIssued: "2",
    building: "A", floor: "2nd Floor", room: "204", custodian: "Dr X",
  });
  f.lines = [l];
  return f;
}

afterEach(() => vi.unstubAllGlobals());

describe("simplified bill formation", () => {
  it("formats rupees with Indian grouping", () => {
    expect(inr(125000)).toBe("₹ 1,25,000.00");
    expect(toNum("₹ 1,25,000.50")).toBe(125000.5);
    expect(Number.isNaN(toNum(""))).toBe(true);
  });

  it("calculates the bill from multiple items plus other charges", () => {
    const f = filled();
    f.lines.push({ ...f.lines[0], qty: "1", unitPrice: "1234.50", qtyIssued: "0" });
    f.otherCharges = "100";
    expect(totals(f)).toMatchObject({ itemsSum: 81234.5, total: 81334.5, units: 3, issued: 2 });
    expect(totals(f)).not.toHaveProperty("poBalance");
  });

  it("uses the Indian financial year", () => {
    expect(financialYear("2026-03-31")).toBe("2025-26");
    expect(financialYear("2026-04-01")).toBe("2026-27");
  });

  it("passes every step without asset rows, a stock page or balance context", () => {
    const f = filled();
    for (let s = 0; s < 6; s++) expect(validateStep(s, f, ctx)).toEqual({});
  });

  it("does not block review when the item total exceeds the PO value", () => {
    const f = filled();
    f.poValue = "1000";
    expect(validateStep(5, f, ctx)).toEqual({});
  });

  it("retains employee lookup and department checks", () => {
    expect(validateStep(0, filled(), { ...ctx, requesterFound: false })["f-requester"]).toBeTruthy();
    expect(validateStep(0, filled(), { ...ctx, requesterDepartment: "SCS" })["f-requester"]).toBeTruthy();
    expect(validateStep(0, filled(), { ...ctx, requesterDepartment: "SCS", filingDepartment: null })).toEqual({});
  });

  it("still requires sensible dates and issued quantities", () => {
    const f = filled();
    f.billDate = "2026-08-01";
    expect(validateStep(2, f, ctx)["f-bill-date"]).toBeTruthy();
    f.lines[0].qtyIssued = "3";
    expect(validateStep(4, f, ctx)["line-0-qty-issued"]).toBeTruthy();
  });

  it("blocks a bill until delivery and installation are complete", () => {
    const f = filled();
    f.delivered = "no";
    expect(validateStep(2, f, ctx)["f-delivery-block"]).toBeTruthy();
    const g = filled();
    g.installDone = "no";
    expect(validateStep(2, g, ctx)["f-delivery-block"]).toBeTruthy();
    g.installRequired = "no";
    g.installDone = "";
    expect(validateStep(2, g, ctx)).toEqual({});
  });

  it("requires custodian and complete placement only at Funding and Stock", () => {
    const f = filled();
    f.lines[0].custodian = "";
    f.lines[0].floor = "";
    expect(validateStep(3, f, ctx)).toEqual({});
    expect(validateStep(4, f, ctx)).toMatchObject({
      "line-0-custodian": expect.any(String), "line-0-room": expect.any(String),
    });
  });

  it("offers separate item types and rejects former combined types", () => {
    const names = typesForGroup("Computer & IT").map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["Laptop", "Notebook", "MacBook"]));
    expect(ITEM_TYPES.some((t) => t.name.includes("/") || t.name.includes(" / "))).toBe(false);
    const f = filled();
    f.lines[0].type = "Laptop/Notebook/MacBook";
    expect(validateStep(3, f, ctx)["line-0-type"]).toBeTruthy();
  });

  it("submits an uppercase ID and preserves custodians and placement, without stock pages or assets", () => {
    const f = filled();
    f.requesterCode = " e001 ";
    const p = toPayload(f);
    expect(p.employee_id).toBe("E001");
    expect(p.po_value).toBe(80000);
    expect(p.qty).toBe(2);
    expect(p).not.toHaveProperty("indenter_name");
    expect(p).not.toHaveProperty("stock_entry");
    expect(p.bill_details).toContain("Custodians: Item 1: Dr X (A › 2nd Floor › 204)");
    expect(p.bill_details).not.toContain("Assets:");
    expect(p.location).toBe("A › 2nd Floor › 204");
  });

  it("migrates old drafts without retaining removed requirements or losing custodians", () => {
    const f = filled();
    const old = {
      ...f, requesterCode: "e001", basicOverride: true, basicManual: "999999", poOverrunReason: "Old reason",
      lines: [{ ...f.lines[0], type: "Laptop/Notebook/MacBook", custodian: undefined, stockPage: "99",
        units: [{ custodian: "Dr X", serial: "SN1" }, { custodian: "Dr Y", serial: "SN2" }] }],
    };
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ form: old, step: 5, savedAt: 1234 }) });
    const draft = loadDraft("test");
    expect(draft?.form.requesterCode).toBe("E001");
    expect(draft?.form.lines[0]).toMatchObject({ custodian: "Dr X, Dr Y", type: "", building: "A" });
    expect(draft?.form).not.toHaveProperty("basicOverride");
    expect(draft?.form).not.toHaveProperty("poOverrunReason");
    expect(draft?.form.lines[0]).not.toHaveProperty("stockPage");
    expect(draft?.form.lines[0]).not.toHaveProperty("units");
    expect(totals(draft!.form).total).toBe(80000);
  });

  it("keeps workflow storage values but shows Store & Purchase to the user", () => {
    expect(deskLabel("Student Purchase")).toBe("Store & Purchase");
    expect(deskLabel("Routed to Student Purchase (Minor)")).toBe("Routed to Store & Purchase (Minor)");
    expect(deskLabel("Finance Admin")).toBe("Finance Admin");
  });
});
