/**
 * Master data for the bill form (Bill-form.md §4, §5, §6).
 *
 * These are STATIC PLACEHOLDERS. The spec wants every dropdown backed by a
 * master table managed by Stores / Accounts; none of those tables exist yet.
 * Each export below is the one place to swap for an API call when they do.
 *
 * Purchase orders and buildings are empty until their masters exist.
 * Suppliers below are demo fixtures; the comboboxes also accept typed values.
 */

export const PURCHASE_TYPES = [
  { value: "po", label: "Against PO" },
  { value: "direct", label: "Direct Purchase (No PO)" },
] as const;

/** Existing options on the live form -- the database CHECK knows exactly these. */
export const ITEM_CATEGORIES = ["Minor", "Major", "Consumables"] as const;

export const UOMS = ["Nos", "Set", "Pair", "Metre", "Kg", "Litre", "Box", "Pack", "Licence"] as const;

export const BRANDS = ["Dell", "HP", "Lenovo", "Apple"] as const;

export const FLOORS = [
  "Basement",
  "Ground Floor",
  "1st Floor",
  "2nd Floor",
  "3rd Floor",
  "4th Floor",
  "5th Floor",
] as const;

/** Buildings and rooms come from Estate; empty until that master exists. */
export const BUILDINGS: string[] = [];

export type Supplier = { name: string; address: string };

/**
 * DEMO suppliers, all fictional, for trying the form. Replace with the real
 * Supplier Master (Purchase / Accounts).
 */
export const SUPPLIERS: Supplier[] = [
  { name: "Demo Computers & Peripherals", address: "12 Industrial Area, Mandi, Himachal Pradesh 175001" },
  { name: "Demo Office Furniture House", address: "45 Bypass Road, Sundernagar, Himachal Pradesh 175018" },
  { name: "Demo Lab Instruments Pvt Ltd", address: "Plot 7, Sector 18, Gurugram, Haryana 122015" },
  { name: "Demo Electricals & Appliances", address: "SCO 21, Sector 9, Chandigarh 160009" },
  { name: "Demo Stationery Mart", address: "Main Bazaar, Mandi, Himachal Pradesh 175001" },
  { name: "Demo Local Hardware Store", address: "Purani Mandi, Mandi, Himachal Pradesh 175001" },
];

export type Fund = { code: string; description: string; group: string };

/**
 * Only OH-31 and OH-35 are confirmed (architecture.jpeg). The remaining
 * codes and descriptions must come from the Finance office's sheet.
 */
export const FUNDS: Fund[] = [
  { code: "OH-31", description: "Recurring consumable", group: "Institute / OH heads" },
  { code: "OH-35", description: "Non-recurring", group: "Institute / OH heads" },
];

export const FUND_PATTERN = /^OH-\d{2,3}$/;

// ---------------------------------------------------------------------
// Item master (Stock_Index.xlsx -> Bill-form.md §5)
// ---------------------------------------------------------------------

export type ItemType = {
  name: string;
  group: string;
  requiresMakeModel: boolean;
  uom: (typeof UOMS)[number];
};

const t = (group: string, name: string, uom: ItemType["uom"] = "Nos"): ItemType => ({
  group,
  name,
  requiresMakeModel: group === "Computer & IT" || group === "Electrical Appliances",
  uom,
});

const IT = "Computer & IT";
const EL = "Electrical Appliances";
const FU = "Furniture";
const BO = "Boards";

export const ITEM_GROUPS = [FU, IT, EL, BO, "Lab Equipment", "Miscellaneous"] as const;

/** Every item type has its own entry; combined labels are not selectable. */
export const ITEM_TYPES: ItemType[] = [
  ...[
    "Visitor Chair", "Revolving Chair", "Lab Table", "Office Table", "Centre Table", "Stool",
    "Desk", "Bench", "Wooden Almirah", "Book case", "Wooden Workstation", "Sofa set", "Bed",
    "Cabinet", "Side Unit", "Rack",
  ].map((n) => t(FU, n, n === "Sofa set" ? "Set" : "Nos")),
  ...[
    "Desktop Computer", "Laptop", "Notebook", "MacBook", "LED", "Monitor", "UPS",
    "External HDD", "Camera", "Printer", "Projector", "Sound System", "Speaker",
    "Mobile Phone", "Shredder Machine", "Lamination Machine", "CPU", "TV", "Biometric Machine",
  ].map((n) => t(IT, n)),
  t(IT, "Software", "Licence"),
  t(IT, "LAN Work", "Set"),
  ...[
    "Heat Pillar", "Oil Heater", "Kettle", "Insect Killer", "Fan", "Blower", "Dryer", "Press",
    "Washing Machine", "Freezer", "Geyser", "Microwave Oven", "Induction", "AC", "Refrigerator",
    "Water Cooler", "Gas Regulator", "Exhaust Fan", "Coffee Machine",
  ].map((n) => t(EL, n)),
  ...["Green Board", "Notice Board", "White Board", "Magnetic Board"].map((n) => t(BO, n)),
];

export const typesForGroup = (group: string) => ITEM_TYPES.filter((i) => i.group === group);
export const findType = (group: string, name: string) =>
  ITEM_TYPES.find((i) => i.group === group && i.name === name);
