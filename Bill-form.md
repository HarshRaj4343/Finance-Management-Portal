# Bill Form Page: Full Specification

## Implemented revision — 9 October 2026

The live `/apply-bill` form now uses one submitter identity, resolved from an
employee/student ID entered without regard to case and displayed in uppercase.
It no longer displays PDA or PO balances, balance warnings, a manual bill amount,
stock-register page numbers, or per-unit asset specification fields. Bill totals
come from item prices plus other charges. Custodian and placement appear only in
Funding and Stock, once per item. Previously combined item types are separate
choices, and bill status summaries display “Store & Purchase”. Stock references
are assigned by the database at submission using migration `0003_stock_entry.sql`.
Existing financial reservation and approval accounting still runs on the server.

The specification below records the earlier design; this revision supersedes
its conflicting identity, balance, amount, stock-page and asset-field requirements.

**Portal:** Integrated Finance Management Portal, IIT Mandi
**Page:** Upload Bill for Store and Purchase Section
**Route (proposed):** `/bills/new` (edit draft: `/bills/[id]/edit`)
**Stack assumed:** Next.js + React + TypeScript, Tailwind + Radix UI, Supabase (Postgres), NextAuth + institutional LDAP

---

## 1. What changes from the current form

| Current field | Decision | Notes |
|---|---|---|
| employee id | **Auto-filled, read-only** | Taken from the logged-in session (LDAP) |
| employee name | **Auto-filled, read-only** | Same |
| po details | **Dropdown (searchable)** | Select from open POs; or "No PO / Direct purchase" |
| po value | **Auto-filled from PO** | Editable only for "No PO" bills |
| supplier name | **Dropdown (searchable)** | From Supplier Master; "Request new supplier" if missing |
| supplier address | **Auto-filled, read-only** | Comes from the Supplier Master |
| item category | **Dropdown** | Keep the existing one (currently shows "Minor"). Options to be confirmed (see §9) |
| item description | **Structured** | Replaced by Item Group, Item Type, then Make/Model fields |
| qty | **Number input** | Integer, ≥ 1; drives per-unit rows |
| bill details | **Split into structured fields** | Bill no., date, amount, GST, total, file upload |
| **indenter name** | **REMOVED** | Not needed. Custodian is captured per asset only where required |
| qty issued | **Number input** | Must be ≤ qty |
| source of fund | **Dropdown** | Standard `OH-xx` codes (see §6) |
| stock entry | **Auto-generated + dropdown for page no.** | Register entry no. is system-generated; page no. comes from the Stock Index |
| location | **Cascading dropdown** | Building, Floor, Room/Lab |
| *(new)* | Item Group and Item Type | From the Stock Index (§5) |
| *(new)* | Asset details (conditional) | Make, model, serial no., and where it is placed (§4.6) |
| *(new)* | Attachments, declaration, draft saving, review step | §3, §7 |

**Principle:** free text only where a dropdown cannot work (bill number, remarks, serial number, model name). Everything else is a standardised dropdown backed by a master table.

---

## 2. Page layout and UX standard

### 2.1 Page structure (top to bottom)

1. **Page header:** title, breadcrumb (`Home / Bills / New Bill`), draft status badge
2. **Progress stepper (sticky):** 1 Submitter, 2 PO and Supplier, 3 Bill, 4 Items, 5 Funding and Stock, 6 Review
3. **Form card(s):** one card per section, 2-column grid on desktop and 1 column on mobile
4. **Live summary panel (right side, desktop only):** PO value, bill total, remaining PO balance, number of units, fund selected
5. **Sticky action bar (bottom):** `Cancel` | `Save Draft` | `Back` | `Next` / `Submit Bill`

### 2.2 Visual and component standards

| Aspect | Standard |
|---|---|
| Labels | Title Case, above the field, required fields marked with a red `*` |
| Placeholders | Instruction only ("Select supplier"), never a substitute for a label |
| Spacing | 8px grid; 24px between fields; 32px between sections |
| Field width | Half-width (2 per row) for short fields; full-width for description, attachments, remarks |
| Select component | Radix `Select` for fewer than 8 options; searchable `Combobox` for 8 or more (PO, Supplier, Item Type, Location, Fund) |
| Primary button | Solid brand colour, full opacity only when the form is valid (the current pale "Submit Bill" looks disabled; make enabled vs disabled clearly different) |
| Secondary actions | Outline button (`Save Draft`, `Back`) and text button (`Cancel`) |
| Colour semantics | Red = error, amber = warning, green = success/verified, grey = read-only/auto-filled |
| Read-only auto-filled fields | Grey background and a small lock icon, with a tooltip stating "Auto-filled from <source>" |
| Help text | One line under the field, 12px, muted |
| Currency | Always ₹, Indian digit grouping (`₹ 1,25,000.00`), right-aligned |
| Dates | `DD MMM YYYY` display, native date picker for input |
| Empty / loading states | Skeleton for dropdown loading; "No results. Request addition" in empty comboboxes |

### 2.3 Interaction rules

- **Cascading dropdowns:** Item Group → Item Type; Building → Floor → Room. A child stays disabled until its parent is chosen, and changing a parent clears the child.
- **Auto-fill:** selecting a PO fills PO date, PO value and supplier. Selecting a supplier fills GSTIN and address.
- **Inline validation:** on blur, with a summary of errors on submit attempt (scroll to first error and focus it).
- **Autosave draft:** every 30 seconds and on section change. A "Saved just now" indicator is shown in the header.
- **Unsaved-changes guard** on navigation away.
- **Keyboard:** full tab order, `Enter` selects in a combobox, `Esc` closes dropdowns.
- **Accessibility:** WCAG 2.1 AA contrast, labels linked to inputs, errors announced via `aria-live`, no colour-only meaning.
- **Responsive:** stepper collapses into "Step 3 of 6" on mobile; the summary panel becomes a collapsible bar above the action bar.

---

## 3. Section-by-section field specification

Legend: **Req** = required. **Auto** = system-filled, read-only. **DD** = dropdown.

### 3.1 Section 1: Submitter

| Field | Type | Req | Source / Values | Validation |
|---|---|---|---|---|
| Employee ID | Auto | Yes | Session (LDAP) | None; read-only |
| Employee Name | Auto | Yes | Session (LDAP) | None; read-only |
| Department / Section | Auto | Yes | Employee profile | None; read-only |
| Submission Date | Auto | Yes | Server date | None |

### 3.2 Section 2: Purchase Order and Supplier

| Field | Type | Req | Source / Values | Validation |
|---|---|---|---|---|
| Purchase Type | DD | Yes | `Against PO`, `Direct Purchase (No PO)` | Controls the fields below |
| PO Number | Searchable DD | If "Against PO" | Open POs from PO Master | Must exist and be open |
| PO Date | Auto | If PO | PO Master | None |
| PO Value (₹) | Auto (editable if Direct Purchase) | Yes | PO Master | Number > 0, 2 decimals |
| PO Balance (₹) | Auto | If PO | PO value minus previously billed | Warn if bill total exceeds balance |
| Supplier Name | Searchable DD | Yes | Supplier Master (auto-selected if PO has a supplier) | Must be an active supplier |
| Supplier GSTIN | Auto | Yes | Supplier Master | GSTIN regex (15 chars) |
| Supplier Address | Auto | Yes | Supplier Master | None; read-only |
| Request New Supplier | Link/modal | No | Sends a request to Stores/Accounts | Not blocking, bill saved as draft until approved |

### 3.3 Section 3: Bill Details

| Field | Type | Req | Values | Validation |
|---|---|---|---|---|
| Bill / Invoice Number | Text | Yes | Free text | Max 50 chars; unique per supplier and financial year (duplicate-bill check) |
| Bill Date | Date | Yes | Date picker | Not in the future; not before PO date |
| Basic Amount (₹) | Number | Yes | Sum of line items (auto, overridable) | > 0 |
| GST Rate | DD | Yes | `0%`, `5%`, `12%`, `18%`, `28%` | |
| GST Amount (₹) | Auto | Yes | Basic × rate | |
| Other Charges (₹) | Number | No | Freight, packing, etc. | ≥ 0 |
| Total Bill Amount (₹) | Auto | Yes | Basic + GST + other | Must match the bill copy (user confirms) |
| Bill Copy (upload) | File | Yes | PDF / JPG / PNG | Max 10 MB, up to 3 files, virus-scanned, preview shown |
| Remarks | Textarea | No | Free text | Max 500 chars |

### 3.4 Section 4: Item Details

| Field | Type | Req | Values | Validation |
|---|---|---|---|---|
| Item Category | DD | Yes | Existing dropdown (e.g. Minor, plus the other classes, see §9) | |
| Item Group | DD | Yes | Furniture, Computer & IT, Electrical Appliances, Boards, Lab Equipment, Miscellaneous | |
| Item Type | Searchable DD | Yes | Filtered by Item Group (full list in §5) | Must exist in the Item Master |
| Item Not Listed? | Link | No | Requests a new Item Type from Stores | |
| Make / Brand | DD or Combobox | Per item type | Brand master (e.g. Dell, HP, Lenovo, Apple) | |
| Model Name / No. | Text | Per item type | Free text | Max 100 chars |
| Item Description | Text | Yes | Short specs (auto-suggested from Item Type + Make + Model) | Max 200 chars |
| Quantity | Number | Yes | Integer | ≥ 1, ≤ 999 |
| Unit of Measure | DD | Yes | Nos, Set, Pair, Metre, Kg, Litre, Box, Pack, Licence | Default per Item Type |
| Unit Price (₹) | Number | Yes | | > 0 |
| Line Total (₹) | Auto | Yes | Qty × unit price | |

> A bill may have **multiple item lines**. Use an "Add another item" button. Each line repeats Item Group through Line Total, and Section 4.6 asset rows are generated per line.

### 3.5 Section 5: Funding, Stock and Issue

| Field | Type | Req | Values | Validation |
|---|---|---|---|---|
| Source of Fund | Searchable DD | Yes | Standard fund codes (see §6) | Must be an active code |
| Stock Entry No. | Auto | Yes | System-generated, e.g. `STK/2026-27/00123` | Read-only |
| Stock Register Page No. | DD | Yes | Page numbers from the Stock Index for the chosen Item Group | |
| Qty Issued | Number | Yes | Integer | 0 ≤ qty issued ≤ qty |
| Stock Balance | Auto | Yes | Qty − qty issued | Read-only |
| Location (default) | Cascading DD | Yes | Building, Floor, Room/Lab (see §7) | Used as the default for all units |

### 3.6 Conditional block: Asset Details ("Which laptop, and where is it placed?")

This block appears **automatically** when the selected Item Type is flagged `asset_tracking = true` in the Item Master (all of Computer & IT, most of Electrical Appliances and Lab Equipment, plus selected others; see §5).

**Behaviour:** if Quantity = N, the form shows **N unit rows**, with a "Copy details to all units" shortcut and bulk paste for serial numbers.

| Field (per unit) | Type | Req | Notes |
|---|---|---|---|
| Unit # | Auto | Yes | 1 to N |
| Make / Brand | DD | Yes | Prefilled from the line |
| Model | Text | Yes | Prefilled from the line |
| Serial Number | Text | Yes | Unique across the whole asset register (duplicate check) |
| Asset Tag / ID | Auto | Yes | System-generated, with printable QR/label |
| Specifications | Fields depend on Item Type (§5.2) | Per type | e.g. RAM, storage, processor for a laptop |
| Warranty (months) | DD | Yes | 0, 6, 12, 24, 36, 48, 60 |
| Warranty Expiry | Auto | Yes | Bill date + warranty |
| Installed / Placed At | Cascading DD | Yes | Building, Floor, Room/Lab. This is where the item physically is |
| Custodian | Searchable employee DD | Yes (for IT items) | Person responsible for the item. Replaces the removed Indenter field wherever accountability is needed |
| Condition at Receipt | DD | Yes | New, Good, Damaged (damaged raises a flag to Stores) |

**Example (Laptop, qty 2):** the form shows Unit 1 and Unit 2, each asking Make = Dell, Model = Latitude 5440, Serial No., RAM/Storage, Warranty, Placed At = Room 204, Block A, and Custodian = Dr. X.

---

## 4. Standardised dropdowns (master tables)

| Dropdown | Master table | Managed by |
|---|---|---|
| Purchase Type | static enum | Dev |
| PO Number | `purchase_orders` | Purchase Section |
| Supplier | `suppliers` | Purchase / Accounts |
| Item Category | `item_categories` | Stores |
| Item Group | `item_groups` | Stores |
| Item Type | `item_types` | Stores |
| Brand | `brands` | Stores |
| Unit of Measure | `units` | Stores |
| GST Rate | static enum | Accounts |
| Source of Fund | `fund_sources` | Accounts / Finance |
| Stock Register Page | `stock_index` | Stores |
| Building / Floor / Room | `locations` (hierarchical) | Estate / Stores |
| Custodian | `employees` | LDAP sync |
| Warranty, Condition | static enums | Dev |

Every master table has: `id`, `code`, `label`, `is_active`, `created_by`, `created_at`, `updated_at`. Deactivate rather than delete, so old bills still resolve.

---

## 5. Item Master (seeded from Stock_Index.xlsx)

### 5.1 Item Types by Item Group

> The spreadsheet gives section titles only for **Furniture**, **Labs Equipments** and **Miscellaneous items**. The other group names below are my proposed labels; please confirm.

**Furniture** (14 types)
Visitor Chair, Revolving Chair, Lab Table, Office Table, Centre Table, Stool, Desk/Bench, Wooden Almirah, Book case, Wooden Workstation, Sofa set, Bed, Cabinet, Side Unit/Rack

**Computer & IT** (17 types; proposed group name)
Desktop Computer, Laptop/Notebook/MacBook, LED/Monitor, UPS, Software, External HDD, Camera, Printer, Projector, LAN Work, Sound System / Speaker, Mobile Phone, Shredder Machine, Lamination Machine, CPU, TV, Biometric Machine

**Electrical Appliances** (17 types; proposed group name)
Heat Pillar, Oil Heater, Kettle, Insect Killer, Fan, Blower, Dryer/Press, Washing Machine, Freezer, Geyser, Microwave Oven / Induction, AC, Refrigerator, Water Cooler, Gas Regulator, Exhaust Fan, Coffee Machine

**Boards** (3 types; proposed group name)
Green Board, Notice Board, White Board / Magnetic Board

**Lab Equipment** (empty in the sheet; to be filled by Stores)

**Miscellaneous** (empty in the sheet; to be filled by Stores)

Each Item Type carries: `stock_register_page`, `asset_tracking` (bool), `default_uom`, `extra_fields[]`.

### 5.2 Extra fields asked per Item Type (asset-tracked items)

| Item Type | Extra fields (in addition to make, model, serial, warranty, location, custodian) |
|---|---|
| Laptop/Notebook/MacBook | Processor, RAM (GB, DD), Storage (GB/TB + type, DD), OS (DD), Screen size, Charger included (Y/N) |
| Desktop Computer / CPU | Processor, RAM, Storage, OS, Monitor attached (links to a Monitor asset) |
| LED/Monitor / TV | Screen size (DD), Resolution (DD), Panel type |
| UPS | Capacity (VA/kVA), Battery count and type, Online/Offline |
| Software | Software name, Version, Licence type (Perpetual/Subscription), No. of seats, Validity start/end, Licence key (stored encrypted, restricted view) |
| External HDD | Capacity, Interface |
| Camera | Type (CCTV/DSLR/Webcam), Resolution, Lens details |
| Printer | Type (Laser/Inkjet/Dot-matrix), Colour/Mono, Network capable |
| Projector | Lumens, Resolution, Mount type |
| LAN Work | Work order no., Number of nodes, Cable type, Area covered (no serial) |
| Sound System / Speaker | Power rating (W), Channels |
| Mobile Phone | IMEI, Storage, SIM issued (Y/N) |
| Shredder / Lamination Machine | Capacity / sheet size |
| Biometric Machine | Type (fingerprint/face), Connectivity |
| AC | Tonnage, Star rating, Type (Split/Window), Indoor and outdoor unit serial numbers |
| Refrigerator / Freezer / Water Cooler | Capacity (L), Star rating |
| Washing Machine | Capacity (kg), Type |
| Geyser | Capacity (L), Star rating |
| Fan / Exhaust Fan / Blower | Size (mm/inch), Type |
| Other electrical appliances | Power rating (W), Voltage |
| Boards | Size (L × W), Type (no serial, quantity-based) |
| Furniture | Material, Dimensions (optional). Quantity-based, no serial; location per batch |

---

## 6. Source of Fund: standard format

### 6.1 Format rule

- Pattern: **`OH-<number>`**, uppercase prefix, hyphen, no spaces (regex `^OH-\d{2,3}$`).
- Dropdown shows **`OH-31 — <Description>`**, stored value is the code only.
- Searchable by code or description, and sorted by code.
- Master data: managed by Accounts/Finance. No hard-coded values in the UI.

### 6.2 Fund codes

> I could only confirm the two codes you gave me. Please fill in the full list and descriptions from your Finance office's sheet before build.

| Code | Display label | Status |
|---|---|---|
| OH-31 | OH-31 — *(description to be added)* | Provided by you |
| OH-35 | OH-35 — *(description to be added)* | Provided by you |
| OH-__ | *(add remaining codes)* | To be confirmed with Finance |

**Optional:** group fund codes by type in the dropdown (e.g. *Institute / OH heads*, *Project / Sponsored*, *PDA*) using grouped Select headers, so users find the right one faster.

**Rules:**
- Only active codes appear.
- Selecting a code shows its **available balance** (if budget tracking is enabled) and warns when the bill total exceeds it.
- Some Item Categories may be restricted to certain fund codes (configurable mapping).

---

## 7. Location standard

- **Hierarchy:** Campus Area → Building → Floor → Room / Lab / Office (stored as a tree in `locations`).
- Dropdown labels read like `Block A › 2nd Floor › Room 204`, with a search across the full path.
- **Default Location** (Section 5) applies to all units, and **per-unit location** (Section 3.6) overrides it.
- For quantity-based items (furniture, boards) one location per batch is enough; "Split across locations" lets the user add more rows whose quantities must sum to the total.
- "Location not listed" opens a request to Estate/Stores.

---

## 8. Validation, business rules and edge cases

1. **Duplicate bill check:** same supplier + bill number + financial year is blocked.
2. **Amount consistency:** Σ(line totals) + GST + other charges = Total Bill Amount. A mismatch of more than ₹1 blocks submit.
3. **PO limits:** the bill total over the PO balance shows an amber warning; submit is allowed only with a justification, and routes for extra approval.
4. **Qty issued ≤ Qty.**
5. **Serial numbers** must be unique across the asset register; number of serial rows = qty.
6. **Date logic:** Bill Date ≥ PO Date; Bill Date ≤ today.
7. **Fund validity:** the fund code must be active and permitted for the item category.
8. **Item not in master:** can be requested; the bill stays in Draft until Stores approves the new item.
9. **File rules:** a bill copy is mandatory; unreadable or oversized files give a clear error.
10. **Concurrency:** editing a bill that has moved past Draft is locked, and changes need a "Return for correction" action.
11. **Session timeout:** the draft is preserved and restored after login.
12. **Partial deliveries:** the same PO may have several bills; PO balance updates accordingly.
13. **Currency:** INR only (foreign purchases out of scope for v1, flagged for later).

---

## 9. Open questions to confirm

1. **Item Category options.** The screenshot shows "Minor" selected. What are the full options (e.g. Minor / Major / Consumable)? I have kept it as a separate dropdown from Item Group.
2. **Group names** for the three unnamed sections in `Stock_Index.xlsx` (proposed above).
3. **Full OH-xx fund list** with descriptions.
4. **Custodian vs indenter:** custodian is asked only for asset-tracked items. If a custodian is needed for every item, say so and it moves to the line level.
5. Is **Stock Register Page No.** a *pre-printed* page (pick from the index) or *issued per entry* (system-generated)? Currently modelled as a pick from the index.
6. Who may **add master data** (items, suppliers, locations): Stores only, or Accounts as well?

---

## 10. After submission

### 10.1 Review step (Step 6)
Read-only summary of every section, with an "Edit" link per section, a **declaration checkbox** ("I confirm the details and attached bill are correct") and `Submit Bill`.

### 10.2 Confirmation screen
- Success banner with **Bill Reference ID** (e.g. `BILL/2026-27/000457`)
- Buttons: `View Bill`, `Download Acknowledgement (PDF)`, `Submit Another Bill`
- Email/in-app notification sent to the submitter and Stores

### 10.3 Status workflow
`Draft` → `Submitted` → `Store Verification` → `Accounts Verification` → `Approved` → `Paid / Closed`
Side states: `Returned for Correction`, `Rejected` (reason mandatory).

### 10.4 Roles and permissions

| Role | Can do on this page |
|---|---|
| Employee / Faculty | Create, save draft, submit, view own bills |
| Store Officer | View all, verify stock entry, add or approve items, return for correction |
| Purchase Officer | Verify PO and supplier details |
| Accounts Officer | Verify fund and amounts, approve or reject |
| Admin | Manage master data, view audit logs |

### 10.5 Audit and data integrity
- Every create/edit/status change logged with user, timestamp, old value and new value
- Uploaded files stored with a checksum; soft-delete only
- Row-level security on bills (submitter and the relevant officers only)
- Rate limiting and server-side validation of every field (never trust client-side checks)

---

## 11. Suggested data model (summary)

```
bills            (id, ref_no, employee_id, purchase_type, po_id, supplier_id, bill_no, bill_date,
                  basic_amount, gst_rate, gst_amount, other_charges, total_amount, fund_source_id,
                  status, remarks, created_at, updated_at)
bill_items       (id, bill_id, item_category_id, item_group_id, item_type_id, brand_id, model,
                  description, qty, uom, unit_price, line_total, qty_issued,
                  stock_entry_no, stock_page_id, default_location_id)
bill_assets      (id, bill_item_id, unit_no, asset_tag, serial_no, specs_json, warranty_months,
                  warranty_expiry, location_id, custodian_employee_id, condition)
bill_attachments (id, bill_id, file_path, mime_type, size, checksum, uploaded_by)
audit_log        (id, entity, entity_id, action, old_json, new_json, user_id, at)
-- masters: purchase_orders, suppliers, item_categories, item_groups, item_types, brands,
--          units, fund_sources, stock_index, locations, employees
```

---

## 12. Acceptance checklist

- [ ] Indenter field removed everywhere (UI, API, DB)
- [ ] All listed fields are dropdowns or auto-filled, except the free-text exceptions in §1
- [ ] Selecting Laptop asks make, model, serial and placement for each unit
- [ ] Source of Fund shows `OH-xx — description` from the master table
- [ ] Item Types match the Stock Index
- [ ] Draft autosave, review step and confirmation screen work
- [ ] All validations in §8 enforced server-side
- [ ] Keyboard and screen-reader pass, and mobile layout checked
