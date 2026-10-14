import { emptyForm, emptyLine, type FormState } from "@/app/apply-bill/bill-form/model";
let serial = 0;
export function billForm(code = "TEST-U", amount = 1000, category = "Consumables"): FormState {
  return { ...emptyForm(), requesterCode: code, requesterName: "Test applicant", purchaseType: "direct", poValue: String(amount),
    supplierName: "Test supplier", supplierAddress: "Mandi", billNo: `TEST-INV-${Date.now()}-${++serial}`,
    billDate: "2026-01-01", delivered: "yes", deliveryDate: "2026-01-02", installRequired: "no",
    fund: "PDA", declaration: true, totalConfirmed: true, category,
    lines: [{ ...emptyLine(), group: "Miscellaneous", type: "Other item (specify in description)",
      description: "Test item", qty: "1", unitPrice: String(amount), qtyIssued: "0", custodian: "Test custodian", building: "A", floor: "Ground Floor", room: "1" }] };
}
