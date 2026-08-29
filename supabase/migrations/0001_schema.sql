-- =====================================================================
-- IIT Mandi Integrated Finance Management Portal
-- 0001_schema.sql  --  full schema, built from scratch
--
-- Maps to architecture.jpeg:
--   Login Portal / Check Employee Type   -> employees.role
--   Apply Bill Workflow                  -> bills + fn_submit_bill
--   Route by Amount                      -> fn_route_after (50,000 threshold)
--   Approval stages (SNP/Audit/Finance)  -> bills.status + bill_approvals
--   Notify User / QR Code Generation     -> bills.bill_number + bill_approvals
--   Departmental register                -> purchase_register
--
-- Run this on a FRESH Supabase project (SQL editor or `supabase db push`).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Clean slate (safe to re-run during development)
-- ---------------------------------------------------------------------
drop table if exists public.purchase_register cascade;
drop table if exists public.bill_approvals   cascade;
drop table if exists public.bills            cascade;
drop table if exists public.pda_balances     cascade;
drop table if exists public.employees        cascade;
drop table if exists public.departments      cascade;
drop table if exists public.counters         cascade;
drop type  if exists public.department       cascade;

-- ---------------------------------------------------------------------
-- 1. Departments
--    The enum is kept because existing columns are typed against it.
--    The table is the source of truth the UI reads from, so the 77-item
--    hardcoded array in finance-admin/page.tsx can be deleted.
-- ---------------------------------------------------------------------
create type public.department as enum (
    'Staff Recruitment Section',
    'Dean Infrastructure (I&S)/Land Acquisition',
    'Dean Resource Generation & Alumni Relations',
    'Central Dak Section',
    'Health Center',
    'School of Computing & Electrical Engineering',
    'School of Chemical Sciences',
    'School of Physical Sciences',
    'School of Mathematical & Statistical Sciences',
    'School of Biosciences & Bio Engineering',
    'School of Mechanical & Materials Engineering',
    'School of Civil & Environmental Engineering',
    'School of Humanities & Social Sciences',
    'School of Management',
    'Advanced Materials Research Center (AMRC)',
    'Centre of Artificial Intelligence and Robotics (CAIR)',
    'Center for Quantum Science and Technologies (CQST)',
    'Centre for Design & Fabrication of Electronic Devices (C4DFED)',
    'Center for Human-Computer Interaction (CHCI)',
    'Center for Climate Change and Disaster Management (C3DAR)',
    'IIT Mandi i-Hub & HCI',
    'IKSMHA Center',
    'Centre for Continuing Education (CCE)',
    'JEE CELL',
    'JAM',
    'GATE',
    'Office of Chief Warden',
    'Parashar Hostel',
    'Chandertaal Hostel',
    'Suvalsar Hostel',
    'Nako Hostel',
    'Dashir Hostel',
    'Beas Kund Hostel',
    'Manimahesh Hostel',
    'Suraj Taal Hostel',
    'Gauri Kund Hostel',
    'Central Mess',
    'Sports',
    'NSS',
    'Guidance & Counselling Cell',
    'Construction & Maintainance Cell',
    'Transportation',
    'Guest House',
    'Housekeeping Services & Waste Management',
    'Creche',
    'Security Unit',
    'Common Rooms',
    'Career & Placement Cell',
    'IIT Mandi Catalyst',
    'Recreation Center',
    'CPWD',
    'Banks',
    'IPDC',
    'IR',
    'Mind Tree School',
    'Renuka Hostel',
    'Rewalsar',
    'Director Office',
    'Deans',
    'Associate Deans',
    'Registrar Office',
    'Administration and Establishment Section',
    'Faculty Establishment and Recruitment',
    'Finance and Accounts',
    'Store and Purchase Section',
    'Rajbhasa Section',
    'Ranking Cell (RC)',
    'Media Cell',
    'Academics Section',
    'Academic Affairs',
    'Research Affairs',
    'Legal Section',
    'Internal Audit',
    'Central Library',
    'DIGITAL AND COMPUTING SERVICES',
    'Dean (SRIC & IR ) Office',
    'Dean (Students) Office'
);

create table public.departments (
    name       public.department primary key,
    code       text not null,               -- short code used in serial numbers
    is_active  boolean not null default true,
    sort_order integer not null default 100
);

-- Populate from the enum so the two can never drift.
insert into public.departments (name, code)
select d, upper(regexp_replace(left(d::text, 12), '[^a-zA-Z0-9]', '', 'g'))
from unnest(enum_range(null::public.department)) as d;

-- Nicer codes for the schools, which is what most bills come from.
update public.departments set code = 'SCEE' where name = 'School of Computing & Electrical Engineering';
update public.departments set code = 'SCS'  where name = 'School of Chemical Sciences';
update public.departments set code = 'SPS'  where name = 'School of Physical Sciences';
update public.departments set code = 'SMSS' where name = 'School of Mathematical & Statistical Sciences';
update public.departments set code = 'SBB'  where name = 'School of Biosciences & Bio Engineering';
update public.departments set code = 'SMME' where name = 'School of Mechanical & Materials Engineering';
update public.departments set code = 'SCEN' where name = 'School of Civil & Environmental Engineering';
update public.departments set code = 'SHSS' where name = 'School of Humanities & Social Sciences';
update public.departments set code = 'SOM'  where name = 'School of Management';

-- ---------------------------------------------------------------------
-- 2. Employees
--    LDAP proves WHO you are. This table decides WHAT you may do.
--    Only the Dean's admin page writes `role`.
-- ---------------------------------------------------------------------
create table public.employees (
    id            uuid primary key default gen_random_uuid(),
    employee_code text not null unique,
    employee_name text not null,
    email         text not null,
    department    public.department not null,
    employee_type text not null default 'User',
    is_active     boolean not null default true,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),

    constraint employees_type_check check (employee_type in (
        'User',
        'Bill Employee',
        'Bill Editor',
        'Student Purchase',
        'Audit',
        'Finance Admin',
        'PDA Manager',
        'Dean'
    )),
    -- employee_code is quoted in register serials and QR payloads, so it may
    -- not carry stray whitespace. The old table had a row named " Audit".
    constraint employees_code_trimmed check (employee_code = btrim(employee_code)),
    constraint employees_name_trimmed check (employee_name = btrim(employee_name)),
    constraint employees_email_shape  check (email ~ '^[^@\s,]+@[^@\s,]+\.[a-zA-Z]{2,}$')
);

create index employees_role_idx on public.employees (employee_type) where is_active;
create index employees_dept_idx on public.employees (department);

-- ---------------------------------------------------------------------
-- 3. PDA balances
--
--    Four columns, one invariant:
--        allocated = balance + committed + spent
--
--    balance   -> money the holder may still commit  (what the UI shows)
--    committed -> reserved by bills that are in flight, not yet spent
--    spent     -> finally approved and gone
--
--    Reserve on submit, release on rejection, settle on final approval.
--    This is the fix for the two money bugs: a rejected bill used to keep
--    the money, and the debit was a second, non-transactional statement.
-- ---------------------------------------------------------------------
create table public.pda_balances (
    id            uuid primary key default gen_random_uuid(),
    employee_id   text not null unique
                  references public.employees (employee_code) on update cascade,
    email         text not null,
    department    public.department not null,
    allocated     numeric(12,2) not null default 0,
    balance       numeric(12,2) not null default 0,
    committed     numeric(12,2) not null default 0,
    spent         numeric(12,2) not null default 0,
    updated_at    timestamptz not null default now(),

    constraint pda_non_negative check (
        allocated >= 0 and balance >= 0 and committed >= 0 and spent >= 0
    ),
    constraint pda_conserved check (
        allocated = balance + committed + spent
    )
);

create index pda_dept_idx on public.pda_balances (department);

-- ---------------------------------------------------------------------
-- 4. Bills
--    Column names are unchanged from the prototype so the existing pages
--    keep rendering. New columns are additive.
-- ---------------------------------------------------------------------
create table public.bills (
    id                     uuid primary key default gen_random_uuid(),

    -- readable identity (shown in the UI, printed on the QR sticker)
    bill_number            text unique,

    -- applicant
    employee_id            text not null
                           references public.employees (employee_code) on update cascade,
    employee_name          text,
    employee_department    public.department,

    -- purchase details (one item per bill, by design decision)
    po_details             text,
    po_value               numeric(12,2) not null check (po_value > 0),
    supplier_name          text,
    supplier_address       text,
    item_category          text not null,
    item_description       text,
    qty                    integer,
    qty_issued             integer,
    bill_details           text,
    indenter_name          text,
    source_of_fund         text,
    stock_entry            text,
    location               text,

    -- bank guarantee, captured by SNP  (architecture.jpeg: "Enter Bank Guarantee")
    has_bank_guarantee     boolean default false,
    bank_guarantee_details text,
    bank_guarantee_amount  numeric(12,2),
    date_of_installation   timestamptz,
    date_of_delivery       timestamptz,

    -- workflow state
    status                 text not null default 'User',
    snp                    text,
    audit                  text,
    finance_admin          text,
    noted                  boolean not null default false,

    -- remarks: kept so the existing pages keep working. bill_approvals is
    -- the real record; these are a denormalised "latest remark per stage".
    remarks                text,
    remarks1               text,   -- SNP
    remarks2               text,   -- Audit
    remarks3               text,   -- reserved
    remarks4               text,   -- reserved

    -- money bookkeeping
    pda_committed          boolean not null default false,
    pda_settled            boolean not null default false,

    -- outcome
    decided_at             timestamptz,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),

    constraint bills_category_check check (
        item_category in ('Major', 'Minor', 'Consumables')
    ),
    constraint bills_status_check check (
        status in ('User', 'Student Purchase', 'Audit', 'Finance Admin', 'Accepted', 'Rejected')
    ),
    constraint bills_snp_check           check (snp           is null or snp           in ('Pending','Hold','Reject','Approved')),
    constraint bills_audit_check         check (audit         is null or audit         in ('Pending','Hold','Reject','Approved')),
    constraint bills_finance_admin_check check (finance_admin is null or finance_admin in ('Pending','Hold','Reject','Approved')),
    -- a terminal bill must have a decision timestamp
    constraint bills_terminal_dated check (
        (status not in ('Accepted','Rejected')) or decided_at is not null
    )
);

create index bills_employee_idx  on public.bills (employee_id);
create index bills_status_idx    on public.bills (status);
create index bills_snp_idx       on public.bills (snp)           where snp           is not null;
create index bills_audit_idx     on public.bills (audit)         where audit         is not null;
create index bills_finance_idx   on public.bills (finance_admin) where finance_admin is not null;
create index bills_created_idx   on public.bills (created_at desc);

-- ---------------------------------------------------------------------
-- 5. bill_approvals  --  the workflow event log
--
--    One row every time anything happens to a bill: who, what, when, from
--    which role, with what remark. Append-only. This is what the QR page
--    and the user's timeline read.
-- ---------------------------------------------------------------------
create table public.bill_approvals (
    id           uuid primary key default gen_random_uuid(),
    bill_id      uuid not null references public.bills (id) on delete cascade,
    seq          integer not null,
    stage        text not null,     -- 'Applicant' | 'Student Purchase' | 'Audit' | 'Finance Admin' | 'System'
    action       text not null,     -- 'Submitted' | 'Approved' | 'Rejected' | 'Hold' | 'Forwarded' | 'Registered'
    actor_code   text,
    actor_name   text,
    actor_role   text,
    remark       text,
    from_status  text,
    to_status    text,
    amount       numeric(12,2),
    created_at   timestamptz not null default now(),

    unique (bill_id, seq),
    constraint approvals_action_check check (
        action in ('Submitted','Approved','Rejected','Hold','Forwarded','Registered','Notified')
    )
);

create index approvals_bill_idx on public.bill_approvals (bill_id, seq);

-- ---------------------------------------------------------------------
-- 6. purchase_register  --  the departmental register
--
--    The official record: one row per finally-approved purchase, given a
--    running serial number at the moment of approval. This is the answer to
--    "where is this purchase actually logged". Append-only.
-- ---------------------------------------------------------------------
create table public.purchase_register (
    id               uuid primary key default gen_random_uuid(),
    serial_no        text not null unique,
    financial_year   text not null,
    bill_id          uuid not null unique references public.bills (id) on delete restrict,
    bill_number      text,
    entry_date       date not null default current_date,

    department       public.department not null,
    employee_code    text not null,
    employee_name    text,
    indenter_name    text,

    item_description text,
    item_category    text,
    qty              integer,
    supplier_name    text,
    supplier_address text,
    amount           numeric(12,2) not null,
    source_of_fund   text,
    stock_entry      text,
    location         text,

    recorded_by      text,          -- employee_code of the approving Finance Admin
    recorded_at      timestamptz not null default now()
);

create index register_dept_idx on public.purchase_register (department, financial_year);
create index register_date_idx on public.purchase_register (entry_date desc);

-- ---------------------------------------------------------------------
-- 7. counters  --  gapless sequence numbers per scope
--    A real sequence would leak gaps on rollback; a register may not skip
--    numbers, so this is a locked-row counter instead.
-- ---------------------------------------------------------------------
create table public.counters (
    scope text primary key,
    value integer not null default 0
);

-- ---------------------------------------------------------------------
-- 8. Append-only enforcement on the two ledgers
-- ---------------------------------------------------------------------
create or replace function public.fn_block_mutation() returns trigger
language plpgsql as $fn$
begin
    raise exception '% is append-only; % is not permitted', tg_table_name, tg_op;
end;
$fn$;

create trigger bill_approvals_append_only
    before update or delete on public.bill_approvals
    for each row execute function public.fn_block_mutation();

create trigger purchase_register_append_only
    before update or delete on public.purchase_register
    for each row execute function public.fn_block_mutation();

-- keep updated_at honest
create or replace function public.fn_touch_updated_at() returns trigger
language plpgsql as $fn$
begin
    new.updated_at := now();
    return new;
end;
$fn$;

create trigger bills_touch     before update on public.bills
    for each row execute function public.fn_touch_updated_at();
create trigger employees_touch before update on public.employees
    for each row execute function public.fn_touch_updated_at();
