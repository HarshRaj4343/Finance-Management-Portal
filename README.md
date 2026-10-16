# Integrated Finance Management Portal — IIT Mandi

This `after-midsem` branch runs Next.js 15, React 19, NextAuth and plain PostgreSQL on the institute's Docker host. LDAP proves identity; active employee records determine permissions. Demo login is retained for branch demonstrations, but demo data is not seeded automatically.

![System architecture](./architecture.jpeg)

## Local development

Use Node.js 22.22.2+ on the 22 series, 24.15.0+ on the 24 series, or 26+, with PostgreSQL 17. Copy `.env.example` to `.env` and configure the database, institutional LDAP and NextAuth secret. Never commit secrets.

```sh
npm ci
npm run db:setup    # existing EMPTY database only; refuses any existing tables
npm run dev
```

Create the database itself with your PostgreSQL administrator first. `db:setup` does not drop an existing database and does not provision fictitious employees.

Provision the initial Dean using a real LDAP identifier in the database (replace all example values):

```sql
INSERT INTO public.employees
  (employee_code, employee_name, email, department, employee_type, is_active)
VALUES
  ('REAL_LDAP_ID', 'Actual Dean Name', 'actual.address@iitmandi.ac.in',
   'Finance and Accounts', 'Dean', true);
```

The Dean then provisions employees and roles through the admin page; the PDA Manager or Dean opens and funds PDA accounts. LDAP authentication alone does not grant portal access to an unprovisioned person.

## Demo login — retained for now

The existing demo usernames are `Dean`, `Finance Admin`, `Audit`, `SNP`, `Bill-form`, `pda manager`, `User` and `E001`–`E008`. In development/test, demo login is enabled by default with password `123`; set `DEMO_LOGIN_ENABLED=false` to disable it or `DEMO_PASSWORD` to change the password. Production requires both `DEMO_LOGIN_ENABLED=true` and an explicitly configured, non-empty `DEMO_PASSWORD`. Existing `.env` values are not changed by these code changes.

Demo accounts must exist and be active in the employees table. Roles still come from the database; demo login does not bypass workflow or financial checks. To provision a **demo database** after migrations, with `DATABASE_URL` exported in your shell:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/seed/0003_demo_data.sql
```

The restored seed only inserts missing demo employees and ₹250,000 starter PDA balances for those newly inserted employees. It never truncates tables, disables triggers, overwrites existing employees/balances or generates fictional bill history. Repeating it is safe. Existing demo bills are left intact. Do not seed a live financial database: these shared-password accounts include the Dean role.

## Financial workflow and safeguards

Major/minor bills start at the Store and Purchase Department; consumables skip that desk. Amounts strictly above ₹50,000 require Audit. Every route ends at Finance Admin. Submission reserves funds, rejection releases them, and final approval spends them and creates one immutable register entry.

Only applicants filing for themselves, or authorised departmental Bill Employees, may submit bills. The separate Bill Editor role is retired: the Bill Employee desk files and corrects bills. Existing Bill Editor accounts still sign in to that desk and can correct, but not file; the Dean should reassign them to Bill Employee. The Store and Purchase Section is the explicitly designated umbrella filing department. Read access does not imply write access. Applicants and filers cannot decide their own bills, and different approval desks require different reviewers.

A new or corrected bill stays with its filer for a **10-minute edit window** (`fn_edit_window` in migration 0006): the filer may correct it, approval desks do not see it, and the database refuses any desk decision. The window **pauses while the correction form is open** and resumes from the same point when it closes (migration 0009). The open form renews a 3-minute pause lease every minute; if the page is closed or the connection lost, the clock restarts when the lease lapses, so an abandoned form cannot keep a bill from its desk indefinitely. A bill may be paused for **30 minutes in all** (`fn_edit_pause_limit`), counted across every pause and every correction; after that the clock runs even with the form open, and the form says so. Pausing changes only timing, not the bill's revision. After the window, the filer may correct it only once a desk holds or rejects it; correcting a rejected bill reserves its funds again and restarts the route. Corrections require the reviewed revision number. They restart the required route and invalidate previous approvals, including bank-guarantee details. The complete before/after record remains in the append-only change log; the bill detail page exposes its revision history. Every decision checks its revision, so an unseen amendment cannot be approved.

**Reject asks where the bill goes** (migration 0010). Pressing Reject at a desk opens a popup with these choices:
- **Send back to an earlier desk**: offered only for desks on the bill's route that have already approved it. Finance Admin can send a bill to Audit or to Store and Purchase, and Audit to Store and Purchase.
- **Send back to the filer**: the same as Hold.
- **Reject permanently**: as before, the bill is closed and its funds are released.

Rejecting permanently stays the default, so the R shortcut followed by Ctrl/⌘ + Enter twice works as before. A remark is optional when sending back to a desk and required for the other two choices.

A bill sent back to a desk keeps its money reserved in the same pool. It is Pending at the receiving desk, approvals from that desk onwards are cleared, and the sending desk shows **Sent back** until the bill reaches it again. The bill then follows the normal route forward, and every later desk reviews it afresh.

The receiving desk sees who sent the bill back and why. It can open the full bill form with **Correct bill** (`fn_desk_amend_bill`) and change anything, money and source of fund included; the reservation follows the corrected amount and fund. The bill stays at that desk, and the person who corrected it may approve it. A correction that would need an earlier desk the bill has not passed is refused; hold the bill for the filer instead. Send-backs and corrections appear on the bill timeline, in its revision history and in the inward/outward registers ("Sent back", "Sent back for correction"). No email is sent for a send-back between desks.

The server validates the complete form and derives money from quantities, unit prices and other charges. Structured items, invoice details, delivery/installation facts and declarations are retained. Supplier + invoice number + invoice financial year is unique across non-rejected bills, with case/whitespace normalisation. Submission keys make repeated network submissions reserve money once. Rejected invoices may be refiled; accepted or in-progress invoices may not.

The PO / purchase value remains a separate entered value representing the order amount. The computed bill total is the sum of **quantity × unit price for each line**. There is no separate Other Charges field: unit prices include freight, packing and similar charges. Older bills that recorded other charges still display them. These values must match to the paise on submission and correction, checked in the form, API and database. This branch requires a full-order bill, not partial/multiple invoicing against one PO. The invoice date must be on or before delivery and installation; installation cannot precede delivery. Same-day dates are allowed.

Consumables have their own twelve domain groups and examples, plus Miscellaneous. Durable equipment such as laptops/MacBooks is not offered as a consumable. Every item group offers a Miscellaneous item with a required custom description; the make selector offers Miscellaneous for an actual custom brand. Brands are filtered by item, not a global unrelated list.

The source choices are OH-31, OH-35 and PDA, and each is a separate pool (migration 0007). **PDA** bills reserve and settle the applicant's PDA account. **OH-31** (general, recurring) and **OH-35** (creation of capital assets) are institute budget heads, funded per financial year by the Dean. An OH bill reserves, releases and spends that head's budget for the year it was filed in and never touches the applicant's PDA. Each bill records the pool holding its money (`funding_pool`); older bills have none and stay on the PDA, where their money was reserved. Fund rule: Consumables use OH-31 or PDA, Major uses OH-35 or PDA, and Minor may use any. The server checks the chosen pool's balance atomically.

The Dean alone sees the **OH-31 Register** and **OH-35 Register** (`/fund-register/OH-31`, `/fund-register/OH-35`). Each shows allocated, available, committed and spent per financial year, the sanctions the Dean recorded (letter or order reference, date, amount) and every bill reservation, release and spend. Both registers are append-only. All Bills and the Purchase Register are also Dean-only.

Store and Purchase review shows filed delivery/installation dates read-only, independently of bank guarantees. Older bills use an unambiguous generated date in their saved text when available; otherwise dates are explicitly marked missing, with no historical backfill. Approve, Hold and Reject are available on both its dashboard and Bill Details for eligible reviewers. Each action opens a summary/confirmation dialog; cancelling does not send a decision. The same confirmation step guards Audit and Finance Admin decisions, bill submission, and employee, role and PDA changes on the Dean, Finance Admin and PDA Manager pages. This is double confirmation, **not OTP-based two-factor authentication**. JSON debugging controls are removed from the Store and Purchase UI. Internal role/status values and URLs remain unchanged to preserve existing records and permissions.

**Inward / Outward Register** (`/movement-register`, open to the Dean, Finance Admin, Audit and Store and Purchase only) follows the office diary and dispatch practice:
- The **inward** register records each bill as it reaches a desk, and where it came from: the filer (new, corrected or resubmitted) or the previous desk.
- The **outward** register records each bill as it leaves a desk, and where it went: the next desk, closed into the purchase register, returned to the filer on hold or rejection, or recalled inside the edit window. It also shows how long the bill stayed at the desk.

Each entry has a **Received / Not received** checkbox (tick it with a click or the Space key). The entry's own desk or the Dean may mark it; other desks see it read-only. The mark is stored on the register row itself (`bill_movements.received`, `received_by`, `received_by_name`, `received_at`, migration 0009). Those are the only columns of a register entry that can ever change, and only through `fn_mark_movement_received`; every change is kept in `change_log`, and the CSV export includes them. When a paused edit window delays a bill, its inward entry shows the time it actually reached the desk.

Migration 0008 writes these entries automatically from the append-only workflow log, with permanent serials per desk, register and financial year (e.g. `SNP/IN/2026-27/00001`, `FA/OUT/2026-27/00042`). It also replays existing history once.

PDA allocations, top-ups, closures, bill transitions and event sequences are transactional. Closed accounts are retained rather than deleted and cannot fund purchases. Administrative and PDA changes have durable before/after audit records. The last active Dean cannot be removed. Deactivation and role changes take effect on the next authenticated request; sessions have a hard eight-hour sign-in lifetime.

Work queues follow all server pages rather than silently truncating at 100/500 bills. Register totals use exactly the same authorised filters as register rows. Financial years and register dates use Asia/Kolkata; counter formats expand instead of truncating large numbers.

## Existing database upgrade — preserve data

Back up first. Do **not** run migration 0001, delete Docker volumes, or rerun old seed scripts on an existing database.

For a local database:

```sh
./scripts/db-backup.sh
npm run db:upgrade
```

For Docker:

```sh
./scripts/db-backup.sh
docker compose exec -T db psql -U ifmp -d ifmp -v ON_ERROR_STOP=1 < db/migrations/0004_integrity.sql
docker compose exec -T db psql -U ifmp -d ifmp -v ON_ERROR_STOP=1 < db/migrations/0005_bill_form_review.sql
docker compose exec -T db psql -U ifmp -d ifmp -v ON_ERROR_STOP=1 < db/migrations/0006_edit_window.sql
docker compose exec -T db psql -U ifmp -d ifmp -v ON_ERROR_STOP=1 < db/migrations/0007_fund_heads.sql
docker compose exec -T db psql -U ifmp -d ifmp -v ON_ERROR_STOP=1 < db/migrations/0008_movement_registers.sql
docker compose exec -T db psql -U ifmp -d ifmp -v ON_ERROR_STOP=1 < db/migrations/0009_edit_pause_and_receipts.sql
docker compose exec -T db psql -U ifmp -d ifmp -v ON_ERROR_STOP=1 < db/migrations/0010_send_back.sql
docker compose up -d --build
```

Migration 0004 is additive, transactional and repeatable. It retains existing bills, account balances and approvals. Conflicting case-insensitive employee IDs stop migration for administrator review; they are not silently merged. Legacy bills without structured invoice/form fields remain readable; their corrections require completing the new form. Historical supplier invoices cannot be deduplicated automatically without reliable invoice data. New finite/quantity constraints use `NOT VALID` to preserve old rows, but enforce correctness on new/changed rows. Administrators should reconcile legacy anomalies before validating these constraints.

Migration 0005 replaces bill validation to enforce purchase-total reconciliation, date order, consumable groups and the PDA fund choice. It does not update any existing records. Run it after 0004.

Migration 0006 adds the edit window and the reopen-after-rejection correction rule. Existing bills get no window, so nothing already at a desk disappears. Migration 0007 adds the OH-31/OH-35 budget heads, their ledger and per-bill funding pools, and rewrites the submission, decision and correction functions to move money only in the bill's own pool. Migration 0009 adds the edit-window pause and the register receipt marks; it does not change existing bills or register entries. Migration 0010 adds sending a bill back to an earlier desk and desk corrections. It adds three nullable columns and widens two check constraints, and changes no existing bill. Repeat upgrades must run 0004 through 0010 in order and finish with the latest, because rerunning an earlier migration restores older functions.

On first Docker database creation, migrations 0001–0010 run in order. Existing volumes do not rerun init scripts. `scripts/deploy-server.sh` takes a custom-format database backup before applying additive migrations; it does not reset volumes. Configure TLS, LDAP and mail in `.env`; see `docker-compose.yml` and `deploy/nginx/`.

`DECISIONS.md` and `Bill-form.md` are retained design/history references, not deployment instructions. Earlier Supabase, destructive demo-dataset and Vercel instructions in the historical decision log are superseded.

## Verification

```sh
npm run lint
npx tsc --noEmit --incremental false
npm test
npm run db:test
npm run build
```

`npm test` runs unit and API-boundary tests, skipping database cases without `TEST_DATABASE_URL`. `npm run db:test` creates a new isolated PostgreSQL cluster, runs the complete suite including real concurrent transactions, then stops it. It never reuses a development or production database. Diagnostic files are retained in the printed temporary directory.

## Operational limits

Supplier/building/PO master integrations are not implemented. Five clearly labelled fictional demo supplier suggestions are provided; supplier/address and location inputs still accept real typed values. Demo names/addresses are not verified vendors. Invoice deduplication relies on consistent supplier identity; aliases require master-data governance. Mail delivery is best-effort and is not a condition of approval; decisions remain visible in the bill timeline even when mail is disabled or unavailable. Real LDAP/SMTP and institutional acceptance testing must be performed in the institute network before handling live money.

Brand suggestions are examples, not procurement endorsements. Audio/electronics choices were checked against official catalogues: [Portronics](https://www.portronics.com/collections/portable-speakers), [boAt](https://www.boat-lifestyle.com/collections/all-speakers), [Zebronics](https://zebronics.com/), [JBL](https://www.jbl.com/bluetooth-speakers/) and [Sony](https://www.sony.co.in/wireless-speakers/portable). Fan/appliance choices: [Havells](https://consumer.havells.com/consumer), [Crompton](https://www.crompton.co.in/pages/product-guide), [Bajaj](https://www.bajajelectricals.com/), [Usha](https://www.usha.com/) and [Orient Electric](https://orientelectric.com/pages/fans). Wire choices also include [Polycab](https://polycab.com/cables), [RR Kabel](https://www.rrkabel.com/products-categories/wires-cables/) and [Finolex](https://www.finolex.com/).
