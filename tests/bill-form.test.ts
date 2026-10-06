import { describe, expect, it } from "vitest";
import {
  emptyForm, emptyLine, emptyUnit, financialYear, inr, toNum, toPayload, totals, validateStep,
} from "../src/app/apply-bill/bill-form/model";

const ctx = { requesterFound: true, requesterDepartment: "SCEE", filingDepartment: "SCEE", pdaBalance: 500000, hasPda: true };

function filled() {
  const f = emptyForm();
  f.requesterCode = "E001";
  f.purchaseType = "po";
  f.poNumber = "PO/26/1";
  f.poDate = "2026-09-01";
  f.poValue = "100000";
  f.supplierName = "Acme";
  f.supplierAddress = "Mandi";
  f.billNo = "INV-9";
  f.billDate = "2026-09-10";
  f.fund = "OH-31";
  f.delivered = "yes";
  f.deliveryDate = "2026-09-05";
  f.installRequired = "yes";
  f.installDone = "yes";
  f.installDate = "2026-09-08";
  f.declaration = true;
  f.totalConfirmed = true;
  const l = emptyLine();
  Object.assign(l, {
    group: "Computer & IT", type: "Laptop/Notebook/MacBook", brand: "Dell", model: "Latitude 5440",
    description: "Dell Latitude 5440", qty: "2", uom: "Nos", unitPrice: "40000", qtyIssued: "2", stockPage: "12",
    building: "A", floor: "2nd Floor", room: "204",
  });
  l.units = [0, 1].map((i) => emptyUnit({ make: "Dell", model: "Latitude 5440", serial: `SN${i}`, custodian: "Dr X" }));
  f.lines = [l];
  return f;
}

describe("bill form model", () => {
  it("formats rupees with Indian grouping", () => {
    expect(inr(125000)).toBe("₹ 1,25,000.00");
    expect(toNum("₹ 1,25,000.50")).toBe(125000.5);
    expect(Number.isNaN(toNum(""))).toBe(true);
  });

  it("works out totals from the lines", () => {
    const T = totals(filled());
    expect(T.itemsSum).toBe(80000);
    expect(T.total).toBe(80000);
    expect(T.units).toBe(2);
    expect(T.poBalance).toBe(20000);
  });

  it("uses the Indian financial year", () => {
    expect(financialYear("2026-03-31")).toBe("2025-26");
    expect(financialYear("2026-04-01")).toBe("2026-27");
  });

  it("passes every step for a complete bill", () => {
    const f = filled();
    for (let s = 0; s < 6; s++) expect(validateStep(s, f, ctx)).toEqual({});
  });

  it("blocks duplicate serials, a bill dated before its PO, and an over-balance bill", () => {
    const f = filled();
    f.lines[0].units[1].serial = "sn0";
    expect(Object.keys(validateStep(3, f, ctx))).toContain("line-0-unit-1-serial");

    const g = filled();
    g.billDate = "2026-08-01";
    expect(validateStep(2, g, ctx)["f-bill-date"]).toBeTruthy();

    expect(validateStep(5, filled(), { ...ctx, pdaBalance: 1000 })["f-pda"]).toBeTruthy();
  });

  it("requires qty issued within qty and a justification when over the PO", () => {
    const f = filled();
    f.lines[0].qtyIssued = "3";
    expect(validateStep(4, f, ctx)["line-0-qty-issued"]).toBeTruthy();

    const g = filled();
    g.poValue = "50000";
    expect(validateStep(5, g, ctx)["f-po-reason"]).toBeTruthy();
    g.poOverrunReason = "Price rise";
    expect(validateStep(5, g, ctx)["f-po-reason"]).toBeUndefined();
  });

  it("blocks a bill until delivery and installation are done", () => {
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

  it("lets a unit inherit the default location, but not half a location", () => {
    const f = filled();
    expect(validateStep(3, f, ctx)).toEqual({});
    f.lines[0].units[0].building = "B";
    expect(validateStep(3, f, ctx)["line-0-unit-0-room"]).toBeTruthy();
  });

  it("builds a payload the existing API understands, without an indenter", () => {
    const p = toPayload(filled());
    expect(p).not.toHaveProperty("indenter_name");
    expect(p.po_value).toBe(80000);
    expect(p.qty).toBe(2);
    expect(p.item_category).toBe("Minor");
    expect(p.supplier_address).toBe("Mandi");
    expect(p.bill_details).toContain("S/N SN0");
    expect(p.location).toBe("A › 2nd Floor › 204");
  });
});
