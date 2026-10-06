/**
 * Master data for the bill form (Bill-form.md §4, §5, §6).
 *
 * These are STATIC PLACEHOLDERS. The spec wants every dropdown backed by a
 * master table managed by Stores / Accounts; none of those tables exist yet.
 * Each export below is the one place to swap for an API call when they do.
 *
 * Deliberately empty (no invented data): purchase orders, suppliers and the
 * building list. Their comboboxes accept a typed value until masters exist.
 */

export const PURCHASE_TYPES = [
  { value: "po", label: "Against PO" },
  { value: "direct", label: "Direct Purchase (No PO)" },
] as const;

/** Existing options on the live form -- the database CHECK knows exactly these. */
export const ITEM_CATEGORIES = ["Minor", "Major", "Consumables"] as const;

export const UOMS = ["Nos", "Set", "Pair", "Metre", "Kg", "Litre", "Box", "Pack", "Licence"] as const;

export const WARRANTY_MONTHS = ["0", "6", "12", "24", "36", "48", "60"] as const;

export const CONDITIONS = ["New", "Good", "Damaged"] as const;

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

export type SpecField = { key: string; label: string; options?: string[] };

const RAM = ["4 GB", "8 GB", "16 GB", "32 GB", "64 GB"];
const STORAGE = ["256 GB SSD", "512 GB SSD", "1 TB SSD", "1 TB HDD", "2 TB HDD"];
const OS = ["Windows 11", "Windows 10", "Ubuntu / Linux", "macOS", "None"];
const STARS = ["1 Star", "2 Star", "3 Star", "4 Star", "5 Star"];

/** Extra fields per spec profile (§5.2). */
export const SPEC_PROFILES: Record<string, SpecField[]> = {
  laptop: [
    { key: "processor", label: "Processor" },
    { key: "ram", label: "RAM", options: RAM },
    { key: "storage", label: "Storage", options: STORAGE },
    { key: "os", label: "OS", options: OS },
    { key: "screen", label: "Screen Size" },
    { key: "charger", label: "Charger Included", options: ["Yes", "No"] },
  ],
  desktop: [
    { key: "processor", label: "Processor" },
    { key: "ram", label: "RAM", options: RAM },
    { key: "storage", label: "Storage", options: STORAGE },
    { key: "os", label: "OS", options: OS },
    { key: "monitor", label: "Monitor Attached (Asset Tag)" },
  ],
  display: [
    { key: "screen", label: "Screen Size", options: ['19"', '21.5"', '24"', '27"', '32"', '43"', '55"'] },
    { key: "resolution", label: "Resolution", options: ["HD", "Full HD", "QHD", "4K"] },
    { key: "panel", label: "Panel Type" },
  ],
  ups: [
    { key: "capacity", label: "Capacity (VA / kVA)" },
    { key: "battery", label: "Battery Count and Type" },
    { key: "mode", label: "Mode", options: ["Online", "Offline"] },
  ],
  software: [
    { key: "name", label: "Software Name" },
    { key: "version", label: "Version" },
    { key: "licence", label: "Licence Type", options: ["Perpetual", "Subscription"] },
    { key: "seats", label: "No. of Seats" },
    { key: "valid_from", label: "Valid From" },
    { key: "valid_to", label: "Valid Until" },
  ],
  hdd: [
    { key: "capacity", label: "Capacity" },
    { key: "interface", label: "Interface" },
  ],
  camera: [
    { key: "kind", label: "Type", options: ["CCTV", "DSLR", "Webcam"] },
    { key: "resolution", label: "Resolution" },
    { key: "lens", label: "Lens Details" },
  ],
  printer: [
    { key: "kind", label: "Type", options: ["Laser", "Inkjet", "Dot-matrix"] },
    { key: "colour", label: "Colour / Mono", options: ["Colour", "Mono"] },
    { key: "network", label: "Network Capable", options: ["Yes", "No"] },
  ],
  projector: [
    { key: "lumens", label: "Lumens" },
    { key: "resolution", label: "Resolution" },
    { key: "mount", label: "Mount Type" },
  ],
  lan: [
    { key: "work_order", label: "Work Order No." },
    { key: "nodes", label: "Number of Nodes" },
    { key: "cable", label: "Cable Type" },
    { key: "area", label: "Area Covered" },
  ],
  speaker: [
    { key: "power", label: "Power Rating (W)" },
    { key: "channels", label: "Channels" },
  ],
  mobile: [
    { key: "imei", label: "IMEI" },
    { key: "storage", label: "Storage" },
    { key: "sim", label: "SIM Issued", options: ["Yes", "No"] },
  ],
  capacity: [{ key: "capacity", label: "Capacity / Sheet Size" }],
  biometric: [
    { key: "kind", label: "Type", options: ["Fingerprint", "Face"] },
    { key: "connectivity", label: "Connectivity" },
  ],
  ac: [
    { key: "tonnage", label: "Tonnage" },
    { key: "stars", label: "Star Rating", options: STARS },
    { key: "kind", label: "Type", options: ["Split", "Window"] },
    { key: "indoor_serial", label: "Indoor Unit Serial No." },
    { key: "outdoor_serial", label: "Outdoor Unit Serial No." },
  ],
  cooling: [
    { key: "capacity", label: "Capacity (L)" },
    { key: "stars", label: "Star Rating", options: STARS },
  ],
  washing: [
    { key: "capacity", label: "Capacity (kg)" },
    { key: "kind", label: "Type", options: ["Top Load", "Front Load", "Semi-automatic"] },
  ],
  fan: [
    { key: "size", label: "Size (mm / inch)" },
    { key: "kind", label: "Type" },
  ],
  electrical: [
    { key: "power", label: "Power Rating (W)" },
    { key: "voltage", label: "Voltage" },
  ],
};

export type ItemType = {
  name: string;
  group: string;
  /** Needs one row per unit with serial, warranty, placement (§3.6). */
  assetTracking: boolean;
  /** The unit rows ask for a serial number. */
  serial: boolean;
  uom: (typeof UOMS)[number];
  spec?: keyof typeof SPEC_PROFILES;
};

const t = (
  group: string,
  name: string,
  o: Partial<Omit<ItemType, "name" | "group">> = {}
): ItemType => ({
  group,
  name,
  assetTracking: false,
  serial: true,
  uom: "Nos",
  ...o,
});

const IT = "Computer & IT";
const EL = "Electrical Appliances";
const FU = "Furniture";
const BO = "Boards";

export const ITEM_GROUPS = [FU, IT, EL, BO, "Lab Equipment", "Miscellaneous"] as const;

/**
 * Group names other than Furniture / Lab Equipment / Miscellaneous are the
 * spec author's proposals (§5.1, open question 2). Which electrical types
 * are asset-tracked ("most", §3.6) is likewise unconfirmed: all are on here.
 */
export const ITEM_TYPES: ItemType[] = [
  // Furniture: quantity-based, no serial, location per batch
  ...[
    "Visitor Chair", "Revolving Chair", "Lab Table", "Office Table", "Centre Table", "Stool",
    "Desk/Bench", "Wooden Almirah", "Book case", "Wooden Workstation", "Sofa set", "Bed",
    "Cabinet", "Side Unit/Rack",
  ].map((n) => t(FU, n, { uom: n === "Sofa set" ? "Set" : "Nos" })),

  t(IT, "Desktop Computer", { assetTracking: true, spec: "desktop" }),
  t(IT, "Laptop/Notebook/MacBook", { assetTracking: true, spec: "laptop" }),
  t(IT, "LED/Monitor", { assetTracking: true, spec: "display" }),
  t(IT, "UPS", { assetTracking: true, spec: "ups" }),
  t(IT, "Software", { assetTracking: true, serial: false, uom: "Licence", spec: "software" }),
  t(IT, "External HDD", { assetTracking: true, spec: "hdd" }),
  t(IT, "Camera", { assetTracking: true, spec: "camera" }),
  t(IT, "Printer", { assetTracking: true, spec: "printer" }),
  t(IT, "Projector", { assetTracking: true, spec: "projector" }),
  t(IT, "LAN Work", { assetTracking: true, serial: false, uom: "Set", spec: "lan" }),
  t(IT, "Sound System / Speaker", { assetTracking: true, spec: "speaker" }),
  t(IT, "Mobile Phone", { assetTracking: true, spec: "mobile" }),
  t(IT, "Shredder Machine", { assetTracking: true, spec: "capacity" }),
  t(IT, "Lamination Machine", { assetTracking: true, spec: "capacity" }),
  t(IT, "CPU", { assetTracking: true, spec: "desktop" }),
  t(IT, "TV", { assetTracking: true, spec: "display" }),
  t(IT, "Biometric Machine", { assetTracking: true, spec: "biometric" }),

  t(EL, "Heat Pillar", { assetTracking: true, spec: "electrical" }),
  t(EL, "Oil Heater", { assetTracking: true, spec: "electrical" }),
  t(EL, "Kettle", { assetTracking: true, spec: "electrical" }),
  t(EL, "Insect Killer", { assetTracking: true, spec: "electrical" }),
  t(EL, "Fan", { assetTracking: true, spec: "fan" }),
  t(EL, "Blower", { assetTracking: true, spec: "fan" }),
  t(EL, "Dryer/Press", { assetTracking: true, spec: "electrical" }),
  t(EL, "Washing Machine", { assetTracking: true, spec: "washing" }),
  t(EL, "Freezer", { assetTracking: true, spec: "cooling" }),
  t(EL, "Geyser", { assetTracking: true, spec: "cooling" }),
  t(EL, "Microwave Oven / Induction", { assetTracking: true, spec: "electrical" }),
  t(EL, "AC", { assetTracking: true, spec: "ac" }),
  t(EL, "Refrigerator", { assetTracking: true, spec: "cooling" }),
  t(EL, "Water Cooler", { assetTracking: true, spec: "cooling" }),
  t(EL, "Gas Regulator", { assetTracking: true, spec: "electrical" }),
  t(EL, "Exhaust Fan", { assetTracking: true, spec: "fan" }),
  t(EL, "Coffee Machine", { assetTracking: true, spec: "electrical" }),

  t(BO, "Green Board"),
  t(BO, "Notice Board"),
  t(BO, "White Board / Magnetic Board"),
];

export const typesForGroup = (group: string) => ITEM_TYPES.filter((i) => i.group === group);
export const findType = (group: string, name: string) =>
  ITEM_TYPES.find((i) => i.group === group && i.name === name);
