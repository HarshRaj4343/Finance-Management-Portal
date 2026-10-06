import { findType, FUND_PATTERN, FUNDS, ITEM_CATEGORIES } from "./masters";

// ---------------------------------------------------------------------
// Shape of the form
// ---------------------------------------------------------------------

export type Place = { building: string; floor: string; room: string };

export type Unit = Place & {
  make: string;
  model: string;
  serial: string;
  warranty: string;
  custodian: string;
  condition: string;
  specs: Record<string, string>;
};

export type Line = Place & {
  key: string;
  group: string;
  type: string;
  brand: string;
  model: string;
  description: string;
  /** once the user edits the description we stop auto-suggesting it */
  descriptionEdited: boolean;
  qty: string;
  uom: string;
  unitPrice: string;
  qtyIssued: string;
  stockPage: string;
  units: Unit[];
};

export type FormState = {
  requesterCode: string;
  requesterName: string;

  purchaseType: "" | "po" | "direct";
  poNumber: string;
  poDate: string;
  poValue: string;
  supplierName: string;
  supplierAddress: string;

  billNo: string;
  billDate: string;
  basicOverride: boolean;
  basicManual: string;
  otherCharges: string;
  remarks: string;

  delivered: "" | "yes" | "no";
  deliveryDate: string;
  installRequired: "" | "yes" | "no";
  installDone: "" | "yes" | "no";
  installDate: string;

  category: string;
  lines: Line[];

  fund: string;

  declaration: boolean;
  totalConfirmed: boolean;
  poOverrunReason: string;
};

export const STEPS = [
  { id: "submitter", label: "Submitter" },
  { id: "supplier", label: "PO and Supplier" },
  { id: "bill", label: "Bill" },
  { id: "items", label: "Items" },
  { id: "funding", label: "Funding and Stock" },
  { id: "review", label: "Review" },
] as const;

export const emptyPlace = (): Place => ({ building: "", floor: "", room: "" });

export const emptyUnit = (from?: Partial<Unit>): Unit => ({
  ...emptyPlace(),
  make: "",
  model: "",
  serial: "",
  warranty: "12",
  custodian: "",
  condition: "New",
  specs: {},
  ...from,
});

let seq = 0;
export const emptyLine = (): Line => ({
  key: `l${Date.now().toString(36)}${seq++}`,
  ...emptyPlace(),
  group: "",
  type: "",
  brand: "",
  model: "",
  description: "",
  descriptionEdited: false,
  qty: "1",
  uom: "Nos",
  unitPrice: "",
  qtyIssued: "",
  stockPage: "",
  units: [],
});

export const emptyForm = (): FormState => ({
  requesterCode: "",
  requesterName: "",
  purchaseType: "",
  poNumber: "",
  poDate: "",
  poValue: "",
  supplierName: "",
  supplierAddress: "",
  billNo: "",
  billDate: "",
  basicOverride: false,
  basicManual: "",
  otherCharges: "",
  remarks: "",
  delivered: "",
  deliveryDate: "",
  installRequired: "",
  installDone: "",
  installDate: "",
  category: "Minor",
  lines: [emptyLine()],
  fund: "",
  declaration: false,
  totalConfirmed: false,
  poOverrunReason: "",
});

// ---------------------------------------------------------------------
// Numbers and dates
// ---------------------------------------------------------------------

/** "1,25,000.50" / "₹ 1250" -> 125000.5 ; anything unparseable -> NaN */
export const toNum = (s: string | number | null | undefined): number => {
  if (typeof s === "number") return s;
  const clean = String(s ?? "").replace(/[₹,\s]/g, "");
  return clean === "" ? NaN : Number(clean);
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const orZero = (n: number) => (Number.isFinite(n) ? n : 0);

/** ₹ 1,25,000.00 */
export const inr = (n: number | string | null | undefined) => {
  const v = typeof n === "number" ? n : toNum(n);
  return (
    "₹ " +
    (Number.isFinite(v) ? v : 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
};

/** 2026-10-06 -> 06 Oct 2026 */
export const shortDate = (iso: string) => {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

export const todayISO = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const placeLabel = (p: Place) =>
  [p.building, p.floor, p.room].filter(Boolean).join(" › ");

export const placeComplete = (p: Place) => Boolean(p.building && p.floor && p.room);

/** Indian financial year, 1 April to 31 March. */
export const financialYear = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
};

// ---------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------

export const lineQty = (l: Line) => {
  const q = toNum(l.qty);
  return Number.isInteger(q) && q > 0 ? q : 0;
};
export const lineTotal = (l: Line) => r2(lineQty(l) * orZero(toNum(l.unitPrice)));

export function totals(f: FormState) {
  const itemsSum = r2(f.lines.reduce((s, l) => s + lineTotal(l), 0));
  const manual = toNum(f.basicManual);
  const basic = f.basicOverride ? orZero(manual) : itemsSum;
  const other = orZero(toNum(f.otherCharges));
  const total = r2(basic + other);
  const units = f.lines.reduce((s, l) => s + lineQty(l), 0);
  const issued = f.lines.reduce((s, l) => s + orZero(toNum(l.qtyIssued)), 0);
  const poValue = toNum(f.poValue);
  const poBalance = Number.isFinite(poValue) ? r2(poValue - total) : null;
  return { itemsSum, basic, other, total, units, issued, poValue, poBalance };
}

export const isAssetLine = (l: Line) => Boolean(findType(l.group, l.type)?.assetTracking);

// ---------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------

export type Errors = Record<string, string>;

export type Context = {
  requesterFound: boolean;
  requesterDepartment: string | null;
  filingDepartment: string | null;
  pdaBalance: number | null;
  hasPda: boolean;
};

const isInt = (s: string) => /^\d+$/.test(s.trim());

export function validateStep(step: number, f: FormState, ctx: Context): Errors {
  const e: Errors = {};
  const T = totals(f);

  if (step === 0) {
    if (!f.requesterCode.trim()) e["f-requester"] = "Enter the ID of the person who placed the order.";
    else if (!ctx.requesterFound) e["f-requester"] = "That employee ID could not be found.";
    else if (!ctx.hasPda) e["f-requester"] = "This employee has no PDA account yet. The PDA Manager must open one first.";
    else if (
      ctx.filingDepartment?.trim() &&
      ctx.requesterDepartment?.trim() &&
      ctx.filingDepartment.trim() !== ctx.requesterDepartment.trim()
    ) {
      e["f-requester"] = `You file for ${ctx.filingDepartment}, but ${f.requesterCode.trim()} belongs to ${ctx.requesterDepartment}.`;
    }
  }

  if (step === 1) {
    if (!f.purchaseType) e["f-purchase-type"] = "Choose how this was purchased.";
    if (f.purchaseType === "po") {
      if (!f.poNumber.trim()) e["f-po-number"] = "Enter or select the PO number.";
      if (!f.poDate) e["f-po-date"] = "Enter the PO date.";
      else if (f.poDate > todayISO()) e["f-po-date"] = "PO date cannot be in the future.";
    }
    if (f.purchaseType) {
      const v = toNum(f.poValue);
      if (!(v > 0)) e["f-po-value"] = "Enter a PO value greater than zero.";
    }
    if (!f.supplierName.trim()) e["f-supplier"] = "Enter or select the supplier.";
    if (!f.supplierAddress.trim()) e["f-address"] = "Enter the supplier's address.";
  }

  if (step === 2) {
    if (!f.billNo.trim()) e["f-bill-no"] = "Enter the bill / invoice number.";
    else if (f.billNo.trim().length > 50) e["f-bill-no"] = "Keep it to 50 characters.";
    if (!f.billDate) e["f-bill-date"] = "Enter the bill date.";
    else if (f.billDate > todayISO()) e["f-bill-date"] = "Bill date cannot be in the future.";
    else if (f.purchaseType === "po" && f.poDate && f.billDate < f.poDate) e["f-bill-date"] = "Bill date cannot be before the PO date.";
    if (f.basicOverride && !(toNum(f.basicManual) > 0)) e["f-basic"] = "Enter a basic amount greater than zero.";
    if (f.otherCharges.trim() && !(toNum(f.otherCharges) >= 0)) e["f-other"] = "Other charges cannot be negative.";
    if (!f.delivered) e["f-delivered"] = "Say whether the goods have been delivered.";
    else if (f.delivered === "yes") {
      if (!f.deliveryDate) e["f-delivery-date"] = "Enter the delivery date.";
      else if (f.deliveryDate > todayISO()) e["f-delivery-date"] = "Delivery date cannot be in the future.";
    }
    if (!f.installRequired) e["f-install-required"] = "Say whether installation is required.";
    else if (f.installRequired === "yes") {
      if (!f.installDone) e["f-install-done"] = "Say whether installation is complete.";
      else if (f.installDone === "yes") {
        if (!f.installDate) e["f-install-date"] = "Enter the installation date.";
        else if (f.installDate > todayISO()) e["f-install-date"] = "Installation date cannot be in the future.";
        else if (f.deliveryDate && f.installDate < f.deliveryDate) e["f-install-date"] = "Installation cannot be before delivery.";
      }
    }
    if (f.delivered === "no") {
      e["f-delivery-block"] = "A bill can only be raised once the goods have been delivered. Come back to this bill after delivery.";
    } else if (f.installRequired === "yes" && f.installDone === "no") {
      e["f-delivery-block"] = "A bill can only be raised once installation is complete. Come back to this bill after installation.";
    }
    if (f.remarks.length > 500) e["f-remarks"] = "Keep remarks to 500 characters.";
  }

  if (step === 3) {
    if (!(ITEM_CATEGORIES as readonly string[]).includes(f.category)) e["f-category"] = "Choose an item category.";
    const serials = new Map<string, string>();
    f.lines.forEach((l, i) => {
      const id = (k: string) => `line-${i}-${k}`;
      const type = findType(l.group, l.type);
      if (!l.group) e[id("group")] = "Choose an item group.";
      if (l.group && !l.type) e[id("type")] = "Choose an item type.";
      if (type?.assetTracking) {
        if (!l.brand.trim()) e[id("brand")] = "Choose or enter the make.";
        if (!l.model.trim()) e[id("model")] = "Enter the model.";
      }
      if (l.model.length > 100) e[id("model")] = "Keep it to 100 characters.";
      if (!l.description.trim()) e[id("description")] = "Describe the item briefly.";
      else if (l.description.length > 200) e[id("description")] = "Keep it to 200 characters.";
      const q = toNum(l.qty);
      if (!Number.isInteger(q) || q < 1 || q > 999) e[id("qty")] = "Whole number from 1 to 999.";
      if (!l.uom) e[id("uom")] = "Choose a unit.";
      if (!(toNum(l.unitPrice) > 0)) e[id("price")] = "Enter a unit price above zero.";

      if (type?.assetTracking) {
        l.units.slice(0, lineQty(l)).forEach((u, j) => {
          const uid = (k: string) => `line-${i}-unit-${j}-${k}`;
          if (!u.make.trim()) e[uid("make")] = "Required.";
          if (!u.model.trim()) e[uid("model")] = "Required.";
          if (type.serial) {
            const s = u.serial.trim().toUpperCase();
            if (!s) e[uid("serial")] = "Required.";
            else if (serials.has(s)) e[uid("serial")] = `Same as ${serials.get(s)}.`;
            else serials.set(s, `Item ${i + 1}, Unit ${j + 1}`);
          }
          if (!u.warranty) e[uid("warranty")] = "Required.";
          // A unit with no placement of its own inherits the line's default
          // location, which step 5 makes mandatory.
          if (placeLabel(u) && !placeComplete(u)) e[uid("room")] = "Finish the location or clear it to use the default.";
          if (l.group === "Computer & IT" && !u.custodian.trim()) e[uid("custodian")] = "Required for IT items.";
          if (!u.condition) e[uid("condition")] = "Required.";
        });
      }
    });
    if (f.basicOverride && Number.isFinite(toNum(f.basicManual)) && Math.abs(toNum(f.basicManual) - T.itemsSum) > 1) {
      e["f-items-sum"] = `Basic amount ${inr(toNum(f.basicManual))} differs from the item total ${inr(T.itemsSum)} by more than ₹ 1. Fix the items or the basic amount.`;
    }
  }

  if (step === 4) {
    const fund = FUNDS.find((x) => x.code === f.fund);
    if (!f.fund) e["f-fund"] = "Choose the source of fund.";
    else if (!FUND_PATTERN.test(f.fund) || !fund) e["f-fund"] = "Choose an active fund code.";
    f.lines.forEach((l, i) => {
      const id = (k: string) => `line-${i}-${k}`;
      if (!l.stockPage.trim()) e[id("stock-page")] = "Enter the register page no.";
      const qi = l.qtyIssued.trim();
      if (!qi) e[id("qty-issued")] = "Enter quantity issued (0 if none).";
      else if (!isInt(qi) || Number(qi) > lineQty(l)) e[id("qty-issued")] = `Whole number from 0 to ${lineQty(l)}.`;
      if (!placeComplete(l)) e[id("room")] = "Choose building, floor and room.";
    });
  }

  if (step === 5) {
    if (!f.declaration) e["f-declaration"] = "Confirm the declaration to submit.";
    if (!f.totalConfirmed) e["f-total-confirmed"] = "Confirm the total matches the supplier's bill.";
    if (T.poBalance !== null && T.poBalance < 0 && !f.poOverrunReason.trim()) {
      e["f-po-reason"] = "This bill exceeds the PO balance. Give a justification.";
    }
    if (!(T.total > 0)) e["f-total"] = "The bill total must be greater than zero.";
    else if (ctx.pdaBalance !== null && T.total > ctx.pdaBalance) {
      e["f-pda"] = `Insufficient PDA balance. ${inr(ctx.pdaBalance)} is available and this bill is ${inr(T.total)}.`;
    }
  }

  return e;
}

/** Which step a field id lives on, so a submit error can jump back to it. */
export function stepOfField(id: string): number {
  if (id === "f-requester") return 0;
  if (/^f-(purchase-type|po-|supplier|address)/.test(id)) return 1;
  if (/^f-(bill-|basic|other|remarks|deliver|install)/.test(id)) return 2;
  if (/^f-(category|items-sum)/.test(id) || /^line-\d+-(group|type|brand|model|description|qty$|uom|price|unit-)/.test(id)) return 3;
  if (/^f-fund/.test(id) || /^line-\d+-(stock-page|qty-issued|room|building|floor)/.test(id)) return 4;
  return 5;
}

// ---------------------------------------------------------------------
// What the existing API understands
// ---------------------------------------------------------------------

/**
 * The database still stores one flat row per bill (see db/migrations
 * 0001_schema.sql: "one item per bill, by design decision"). Until the
 * structured tables of Bill-form.md §11 exist, the richer form is folded
 * into the existing text columns. Nothing here sends `indenter_name`.
 */
export function toPayload(f: FormState) {
  const T = totals(f);
  const lineText = f.lines
    .map((l) => {
      const make = [l.brand, l.model].filter(Boolean).join(" ");
      return `${lineQty(l)} ${l.uom} ${l.type}${make ? ` (${make})` : ""}: ${l.description.trim()}`;
    })
    .join("; ");

  const assets = f.lines
    .flatMap((l, i) =>
      isAssetLine(l)
        ? l.units.slice(0, lineQty(l)).map((u, j) => {
            const bits = [
              `I${i + 1}/U${j + 1}`,
              [u.make, u.model].filter(Boolean).join(" "),
              u.serial.trim() && `S/N ${u.serial.trim()}`,
              `${u.warranty}m warranty`,
              placeLabel(u) || placeLabel(l),
              u.custodian.trim() && `custodian ${u.custodian.trim()}`,
              u.condition,
            ].filter(Boolean);
            return bits.join(", ");
          })
        : []
    )
    .join(" | ");

  const billDetails = [
    `Bill No. ${f.billNo.trim()} dated ${shortDate(f.billDate)}`,
    `Amount ${inr(T.basic)}, other ${inr(T.other)}, total ${inr(T.total)}`,
    `Delivered ${shortDate(f.deliveryDate)}`,
    f.installRequired === "yes" ? `Installed ${shortDate(f.installDate)}` : "No installation required",
    f.remarks.trim() && `Remarks: ${f.remarks.trim()}`,
    f.poOverrunReason.trim() && `PO overrun justification: ${f.poOverrunReason.trim()}`,
    assets && `Assets: ${assets}`,
  ]
    .filter(Boolean)
    .join(". ");

  return {
    employee_id: f.requesterCode.trim(),
    employee_name: f.requesterName.trim(),
    po_details:
      f.purchaseType === "po"
        ? `PO ${f.poNumber.trim()} dated ${shortDate(f.poDate)}, value ${inr(toNum(f.poValue))}`
        : `Direct purchase (no PO), value ${inr(toNum(f.poValue))}`,
    // The amount reserved against the PDA and used for routing.
    po_value: T.total,
    supplier_name: f.supplierName.trim(),
    supplier_address: f.supplierAddress.trim(),
    item_category: f.category,
    item_description: lineText,
    qty: T.units,
    bill_details: billDetails,
    qty_issued: T.issued,
    source_of_fund: f.fund,
    stock_entry: `Register page ${[...new Set(f.lines.map((l) => l.stockPage.trim()))].join(", ")}`,
    location: [...new Set(f.lines.map((l) => placeLabel(l)))].join(" | "),
  };
}

// ---------------------------------------------------------------------
// Draft storage (this browser only, for now)
// ---------------------------------------------------------------------

export type Draft = { form: FormState; step: number; savedAt: number };

export function loadDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    if (!d?.form || !Array.isArray(d.form.lines)) return null;
    // Drafts saved before a field existed come back without it.
    const blank = emptyForm();
    return {
      ...d,
      form: {
        ...blank,
        ...d.form,
        lines: d.form.lines.map((l) => ({ ...emptyLine(), ...l, units: (l.units ?? []).map((u) => emptyUnit(u)) })),
      },
    };
  } catch {
    return null;
  }
}

export function saveDraft(key: string, d: Draft): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}
