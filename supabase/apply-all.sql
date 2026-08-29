-- =====================================================================
-- apply-all.sql  --  GENERATED, do not edit
--
-- The three migration files concatenated with psql-only commands
-- stripped, so the whole thing pastes into the Supabase SQL editor at
-- once. Edit the sources and re-run scripts/build-apply-all.sh.
--
-- ---------------------------------------------------------------------
-- THIS DROPS AND RECREATES employees, pda_balances AND bills.
-- Anything already in them is lost. Back up first.
-- ---------------------------------------------------------------------
-- =====================================================================


-- ###################################################################
-- supabase/migrations/0001_schema.sql
-- ###################################################################

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


-- ###################################################################
-- supabase/migrations/0002_functions.sql
-- ###################################################################

-- =====================================================================
-- 0002_functions.sql  --  the workflow engine
--
-- Every state change to a bill goes through exactly one of two functions:
--
--     fn_submit_bill(payload, actor)   -- create + reserve PDA + log
--     fn_bill_action(...)              -- approve / reject / hold + log
--
-- Both run inside a single transaction, so the bill, the money and the
-- event log can never disagree. The API layer is the only caller; nothing
-- in the browser writes to these tables directly any more.
--
-- >>> To change the numbering formats, edit fn_next_bill_number and
-- >>> fn_next_register_serial below. Nothing else depends on their shape.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Financial year, Indian convention: 1 April -> 31 March.
-- 2026-08-29 -> '2026-27'.  2026-02-14 -> '2025-26'.
-- ---------------------------------------------------------------------
create or replace function public.fn_financial_year(ts timestamptz default now())
returns text language sql immutable as $fn$
    select case
        when extract(month from ts) >= 4
            then to_char(ts, 'YYYY') || '-' || to_char(ts + interval '1 year', 'YY')
        else to_char(ts - interval '1 year', 'YYYY') || '-' || to_char(ts, 'YY')
    end;
$fn$;

-- ---------------------------------------------------------------------
-- Gapless counter. Locks the scope row for the rest of the transaction,
-- so two concurrent approvals cannot take the same register number.
-- ---------------------------------------------------------------------
create or replace function public.fn_next_counter(p_scope text)
returns integer language plpgsql as $fn$
declare
    v_next integer;
begin
    insert into public.counters (scope, value)
        values (p_scope, 0)
        on conflict (scope) do nothing;

    update public.counters
       set value = value + 1
     where scope = p_scope
    returning value into v_next;

    return v_next;
end;
$fn$;

-- ---------------------------------------------------------------------
-- Bill number: handed out at submission.   IITM/2026-27/00042
-- ---------------------------------------------------------------------
create or replace function public.fn_next_bill_number(ts timestamptz default now())
returns text language plpgsql as $fn$
declare
    v_fy  text := public.fn_financial_year(ts);
    v_seq integer;
begin
    v_seq := public.fn_next_counter('bill:' || v_fy);
    return 'IITM/' || v_fy || '/' || lpad(v_seq::text, 5, '0');
end;
$fn$;

-- ---------------------------------------------------------------------
-- Register serial: handed out only when a bill is finally approved.
-- Per department, per financial year.   SCEE/2026-27/0007
-- (Demo format -- change here when the real one is decided.)
-- ---------------------------------------------------------------------
create or replace function public.fn_next_register_serial(
    p_department public.department,
    ts timestamptz default now()
) returns text language plpgsql as $fn$
declare
    v_fy   text := public.fn_financial_year(ts);
    v_code text;
    v_seq  integer;
begin
    select code into v_code from public.departments where name = p_department;
    v_code := coalesce(v_code, 'GEN');
    v_seq  := public.fn_next_counter('reg:' || v_code || ':' || v_fy);
    return v_code || '/' || v_fy || '/' || lpad(v_seq::text, 4, '0');
end;
$fn$;

-- ---------------------------------------------------------------------
-- Append one row to the workflow event log.
-- ---------------------------------------------------------------------
create or replace function public.fn_log_event(
    p_bill_id     uuid,
    p_stage       text,
    p_action      text,
    p_actor_code  text,
    p_actor_name  text,
    p_actor_role  text,
    p_remark      text,
    p_from_status text,
    p_to_status   text,
    p_amount      numeric default null
) returns void language plpgsql as $fn$
declare
    v_seq integer;
begin
    select coalesce(max(seq), 0) + 1 into v_seq
      from public.bill_approvals where bill_id = p_bill_id;

    insert into public.bill_approvals
        (bill_id, seq, stage, action, actor_code, actor_name, actor_role,
         remark, from_status, to_status, amount)
    values
        (p_bill_id, v_seq, p_stage, p_action, p_actor_code, p_actor_name,
         p_actor_role, nullif(btrim(coalesce(p_remark, '')), ''),
         p_from_status, p_to_status, p_amount);
end;
$fn$;

-- ---------------------------------------------------------------------
-- Where does a bill go once the current stage clears it?
--   architecture.jpeg: "Route by Amount", threshold Rs 50,000.
--
--   Major / Minor  -> Student Purchase first, then by amount
--   Consumables    -> skip Student Purchase entirely
--   <= 50,000      -> straight to Finance Admin
--   >  50,000      -> Audit, then Finance Admin
--
-- p_from is the stage that just cleared: 'Submit', 'Student Purchase',
-- or 'Audit'. Returns the next status.
-- ---------------------------------------------------------------------
create or replace function public.fn_route_after(
    p_from     text,
    p_category text,
    p_amount   numeric
) returns text language plpgsql immutable as $fn$
begin
    if p_from = 'Submit' then
        if p_category = 'Consumables' then
            return case when p_amount <= 50000 then 'Finance Admin' else 'Audit' end;
        else
            return 'Student Purchase';
        end if;

    elsif p_from = 'Student Purchase' then
        return case when p_amount <= 50000 then 'Finance Admin' else 'Audit' end;

    elsif p_from = 'Audit' then
        return 'Finance Admin';

    end if;

    raise exception 'fn_route_after: unknown stage %', p_from;
end;
$fn$;

-- =====================================================================
-- fn_submit_bill
--
-- Creates the bill, reserves the money against the applicant's PDA and
-- writes the first event -- all in one transaction. If the reservation
-- fails, the bill is not created.
--
-- p_payload: the form fields, as jsonb.
-- p_actor:   { code, name, role } of the logged-in filer.
-- Returns the created bill row as jsonb.
-- =====================================================================
create or replace function public.fn_submit_bill(p_payload jsonb, p_actor jsonb)
returns jsonb language plpgsql as $fn$
declare
    v_emp_code  text    := btrim(p_payload->>'employee_id');
    v_amount    numeric := (p_payload->>'po_value')::numeric;
    v_category  text    := p_payload->>'item_category';
    v_emp       public.employees%rowtype;
    v_pda       public.pda_balances%rowtype;
    v_status    text;
    v_number    text;
    v_bill      public.bills%rowtype;
begin
    if v_emp_code is null or v_emp_code = '' then
        raise exception 'An employee ID is required.' using errcode = 'P0001';
    end if;
    if v_amount is null or v_amount <= 0 then
        raise exception 'The bill amount must be greater than zero.' using errcode = 'P0001';
    end if;
    if v_category not in ('Major', 'Minor', 'Consumables') then
        raise exception 'Unknown item category "%".', v_category using errcode = 'P0001';
    end if;

    select * into v_emp from public.employees
        where employee_code = v_emp_code and is_active;
    if not found then
        raise exception 'No active employee with ID "%". Ask the Dean''s office to add them first.', v_emp_code
            using errcode = 'P0001';
    end if;

    -- Lock the PDA row: two bills filed at the same moment cannot both
    -- pass the balance check against the same money.
    select * into v_pda from public.pda_balances
        where employee_id = v_emp_code for update;
    if not found then
        raise exception 'No PDA account exists for "%".', v_emp_code using errcode = 'P0001';
    end if;

    if v_pda.balance < v_amount then
        raise exception 'Insufficient PDA balance. Available Rs %, bill is Rs %.',
            trim(to_char(v_pda.balance, 'FM999999990.00')),
            trim(to_char(v_amount,     'FM999999990.00'))
            using errcode = 'P0001';
    end if;

    v_status := public.fn_route_after('Submit', v_category, v_amount);
    v_number := public.fn_next_bill_number();

    insert into public.bills (
        bill_number, employee_id, employee_name, employee_department,
        po_details, po_value, supplier_name, supplier_address,
        item_category, item_description, qty, qty_issued, bill_details,
        indenter_name, source_of_fund, stock_entry, location,
        status, snp, audit, finance_admin, pda_committed
    ) values (
        v_number,
        v_emp_code,
        coalesce(nullif(btrim(p_payload->>'employee_name'), ''), v_emp.employee_name),
        v_emp.department,
        nullif(btrim(p_payload->>'po_details'), ''),
        v_amount,
        nullif(btrim(p_payload->>'supplier_name'), ''),
        nullif(btrim(p_payload->>'supplier_address'), ''),
        v_category,
        nullif(btrim(p_payload->>'item_description'), ''),
        nullif(p_payload->>'qty', '')::integer,
        nullif(p_payload->>'qty_issued', '')::integer,
        nullif(btrim(p_payload->>'bill_details'), ''),
        nullif(btrim(p_payload->>'indenter_name'), ''),
        nullif(btrim(p_payload->>'source_of_fund'), ''),
        nullif(btrim(p_payload->>'stock_entry'), ''),
        nullif(btrim(p_payload->>'location'), ''),
        v_status,
        case when v_status = 'Student Purchase' then 'Pending' end,
        case when v_status = 'Audit'            then 'Pending' end,
        case when v_status = 'Finance Admin'    then 'Pending' end,
        true
    ) returning * into v_bill;

    -- Reserve, do not spend. The money leaves `balance` but is not yet
    -- `spent`; a rejection puts it straight back.
    update public.pda_balances
       set balance    = balance   - v_amount,
           committed  = committed + v_amount,
           updated_at = now()
     where employee_id = v_emp_code;

    perform public.fn_log_event(
        v_bill.id, 'Applicant', 'Submitted',
        p_actor->>'code', p_actor->>'name', p_actor->>'role',
        format('Bill %s filed for %s. Rs %s reserved against the PDA of %s.',
               v_number, coalesce(v_bill.item_description, 'purchase'),
               trim(to_char(v_amount, 'FM999999990.00')), v_emp_code),
        null, v_status, v_amount
    );

    perform public.fn_log_event(
        v_bill.id, 'System', 'Forwarded',
        null, null, null,
        format('Routed to %s (%s, Rs %s).', v_status, v_category,
               trim(to_char(v_amount, 'FM999999990.00'))),
        null, v_status, v_amount
    );

    return to_jsonb(v_bill);
end;
$fn$;

-- =====================================================================
-- fn_bill_action
--
-- The single entry point for approve / reject / hold. Validates that the
-- actor owns the stage the bill is actually sitting in, moves it, logs
-- it, and settles the money on the terminal transitions.
--
--   approve at Finance Admin -> Accepted, PDA settled, register entry cut
--   reject   at any stage    -> Rejected, PDA released. Terminal: the
--                               applicant must file a fresh bill.
--   hold                     -> stays in place, remark recorded
--
-- p_extra carries the bank-guarantee fields SNP collects.
-- =====================================================================
create or replace function public.fn_bill_action(
    p_bill_id    uuid,
    p_actor_code text,
    p_actor_name text,
    p_actor_role text,
    p_action     text,          -- 'Approved' | 'Rejected' | 'Hold'
    p_remark     text default null,
    p_extra      jsonb default '{}'::jsonb
) returns jsonb language plpgsql as $fn$
declare
    v_bill    public.bills%rowtype;
    v_stage   text;
    v_next    text;
    v_serial  text;
    v_remark  text := nullif(btrim(coalesce(p_remark, '')), '');
    v_stamped text;
    v_was_committed boolean;
begin
    if p_action not in ('Approved', 'Rejected', 'Hold') then
        raise exception 'Unknown action "%".', p_action using errcode = 'P0001';
    end if;

    select * into v_bill from public.bills where id = p_bill_id for update;
    if not found then
        raise exception 'No such bill.' using errcode = 'P0001';
    end if;

    if v_bill.status in ('Accepted', 'Rejected') then
        raise exception 'This bill is already % and cannot be changed.', lower(v_bill.status)
            using errcode = 'P0001';
    end if;

    -- The stage a bill is in IS its status. The actor must own it.
    v_stage := v_bill.status;
    if v_stage <> p_actor_role then
        raise exception 'This bill is with %, not %.', v_stage, p_actor_role
            using errcode = 'P0001';
    end if;

    if p_action in ('Rejected', 'Hold') and v_remark is null then
        raise exception 'A remark is required in order to % this bill.',
            case p_action when 'Rejected' then 'reject' else 'hold' end
            using errcode = 'P0001';
    end if;

    v_stamped := case when v_remark is null then null else
        format('%s (By: %s at %s)', v_remark,
               coalesce(p_actor_name, p_actor_code, p_actor_role),
               to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM'))
    end;

    -- ---------------- HOLD: no movement, no money ----------------
    if p_action = 'Hold' then
        update public.bills set
            snp           = case when v_stage = 'Student Purchase' then 'Hold' else snp           end,
            audit         = case when v_stage = 'Audit'            then 'Hold' else audit         end,
            finance_admin = case when v_stage = 'Finance Admin'    then 'Hold' else finance_admin end,
            remarks1      = case when v_stage = 'Student Purchase' then v_stamped else remarks1 end,
            remarks2      = case when v_stage = 'Audit'            then v_stamped else remarks2 end,
            remarks       = case when v_stage = 'Finance Admin'    then v_stamped else remarks  end
        where id = p_bill_id returning * into v_bill;

        perform public.fn_log_event(p_bill_id, v_stage, 'Hold',
            p_actor_code, p_actor_name, p_actor_role, v_remark,
            v_stage, v_stage, v_bill.po_value);

        return to_jsonb(v_bill);
    end if;

    -- ---------------- REJECT: terminal, money goes back ----------------
    if p_action = 'Rejected' then
        v_was_committed := v_bill.pda_committed;

        update public.bills set
            status        = 'Rejected',
            decided_at    = now(),
            snp           = case when v_stage = 'Student Purchase' then 'Reject' else snp           end,
            audit         = case when v_stage = 'Audit'            then 'Reject' else audit         end,
            finance_admin = case when v_stage = 'Finance Admin'    then 'Reject' else finance_admin end,
            remarks1      = case when v_stage = 'Student Purchase' then v_stamped else remarks1 end,
            remarks2      = case when v_stage = 'Audit'            then v_stamped else remarks2 end,
            remarks       = case when v_stage = 'Finance Admin'    then v_stamped else remarks  end,
            pda_committed = false
        where id = p_bill_id returning * into v_bill;

        if v_was_committed then
            update public.pda_balances
               set balance    = balance   + v_bill.po_value,
                   committed  = committed - v_bill.po_value,
                   updated_at = now()
             where employee_id = v_bill.employee_id;
        end if;

        perform public.fn_log_event(p_bill_id, v_stage, 'Rejected',
            p_actor_code, p_actor_name, p_actor_role, v_remark,
            v_stage, 'Rejected', v_bill.po_value);

        perform public.fn_log_event(p_bill_id, 'System', 'Forwarded',
            null, null, null,
            format('Rs %s released back to the PDA of %s.',
                   trim(to_char(v_bill.po_value, 'FM999999990.00')), v_bill.employee_id),
            'Rejected', 'Rejected', v_bill.po_value);

        return to_jsonb(v_bill);
    end if;

    -- ---------------- APPROVE ----------------
    if v_stage = 'Finance Admin' then
        -- Final approval. Money is spent, and the purchase enters the register.
        update public.bills set
            status        = 'Accepted',
            finance_admin = 'Approved',
            decided_at    = now(),
            remarks       = coalesce(v_stamped, remarks),
            pda_committed = false,
            pda_settled   = true
        where id = p_bill_id returning * into v_bill;

        update public.pda_balances
           set committed  = committed - v_bill.po_value,
               spent      = spent     + v_bill.po_value,
               updated_at = now()
         where employee_id = v_bill.employee_id;

        v_serial := public.fn_next_register_serial(v_bill.employee_department);

        insert into public.purchase_register (
            serial_no, financial_year, bill_id, bill_number, entry_date,
            department, employee_code, employee_name, indenter_name,
            item_description, item_category, qty, supplier_name,
            supplier_address, amount, source_of_fund, stock_entry, location,
            recorded_by
        ) values (
            v_serial, public.fn_financial_year(), v_bill.id, v_bill.bill_number, current_date,
            v_bill.employee_department, v_bill.employee_id, v_bill.employee_name,
            v_bill.indenter_name, v_bill.item_description, v_bill.item_category,
            v_bill.qty, v_bill.supplier_name, v_bill.supplier_address,
            v_bill.po_value, v_bill.source_of_fund, v_bill.stock_entry,
            v_bill.location, p_actor_code
        );

        perform public.fn_log_event(p_bill_id, 'Finance Admin', 'Approved',
            p_actor_code, p_actor_name, p_actor_role, v_remark,
            v_stage, 'Accepted', v_bill.po_value);

        perform public.fn_log_event(p_bill_id, 'System', 'Registered',
            null, null, null,
            format('Entered in the %s register as %s. Rs %s debited from the PDA of %s.',
                   v_bill.employee_department, v_serial,
                   trim(to_char(v_bill.po_value, 'FM999999990.00')), v_bill.employee_id),
            'Accepted', 'Accepted', v_bill.po_value);

        return to_jsonb(v_bill);
    end if;

    -- Intermediate approval: hand the bill on to the next desk.
    v_next := public.fn_route_after(v_stage, v_bill.item_category, v_bill.po_value);

    update public.bills set
        status        = v_next,
        snp           = case when v_stage = 'Student Purchase' then 'Approved' else snp   end,
        remarks1      = case when v_stage = 'Student Purchase' then coalesce(v_stamped, remarks1) else remarks1 end,
        remarks2      = case when v_stage = 'Audit'            then coalesce(v_stamped, remarks2) else remarks2 end,
        audit         = case
                          when v_stage = 'Audit' then 'Approved'
                          when v_next  = 'Audit' then 'Pending'
                          else audit
                        end,
        finance_admin = case when v_next = 'Finance Admin' then 'Pending' else finance_admin end,
        -- bank guarantee, collected at the Student Purchase desk
        has_bank_guarantee     = case when v_stage = 'Student Purchase'
                                      then coalesce((p_extra->>'has_bank_guarantee')::boolean, false)
                                      else has_bank_guarantee end,
        bank_guarantee_details = case when v_stage = 'Student Purchase'
                                      then nullif(btrim(coalesce(p_extra->>'bank_guarantee_details','')), '')
                                      else bank_guarantee_details end,
        bank_guarantee_amount  = case when v_stage = 'Student Purchase'
                                      then nullif(p_extra->>'bank_guarantee_amount','')::numeric
                                      else bank_guarantee_amount end,
        date_of_installation   = case when v_stage = 'Student Purchase'
                                      then nullif(p_extra->>'date_of_installation','')::timestamptz
                                      else date_of_installation end,
        date_of_delivery       = case when v_stage = 'Student Purchase'
                                      then nullif(p_extra->>'date_of_delivery','')::timestamptz
                                      else date_of_delivery end
    where id = p_bill_id returning * into v_bill;

    perform public.fn_log_event(p_bill_id, v_stage, 'Approved',
        p_actor_code, p_actor_name, p_actor_role, v_remark,
        v_stage, v_next, v_bill.po_value);

    perform public.fn_log_event(p_bill_id, 'System', 'Forwarded',
        null, null, null,
        format('Forwarded to %s.', v_next),
        v_stage, v_next, v_bill.po_value);

    return to_jsonb(v_bill);
end;
$fn$;

-- =====================================================================
-- fn_set_pda_allocation
--   The PDA Manager tops up or reduces an allocation. Only the free part
--   of the balance moves; committed and spent money is untouchable.
-- =====================================================================
create or replace function public.fn_set_pda_allocation(
    p_employee_code text,
    p_allocated     numeric,
    p_actor_code    text default null
) returns jsonb language plpgsql as $fn$
declare
    v_pda public.pda_balances%rowtype;
begin
    select * into v_pda from public.pda_balances
        where employee_id = p_employee_code for update;
    if not found then
        raise exception 'No PDA account for "%".', p_employee_code using errcode = 'P0001';
    end if;

    if p_allocated < v_pda.committed + v_pda.spent then
        raise exception
            'Cannot set the allocation to Rs % -- Rs % is already committed or spent.',
            trim(to_char(p_allocated, 'FM999999990.00')),
            trim(to_char(v_pda.committed + v_pda.spent, 'FM999999990.00'))
            using errcode = 'P0001';
    end if;

    update public.pda_balances
       set allocated  = p_allocated,
           balance    = p_allocated - committed - spent,
           updated_at = now()
     where employee_id = p_employee_code
    returning * into v_pda;

    return to_jsonb(v_pda);
end;
$fn$;

-- =====================================================================
-- fn_register_totals
--   Summary line for the register page: how many entries and how much
--   money, for the current filter. Counted in the database so the page
--   does not have to pull every row to add them up.
-- =====================================================================
create or replace function public.fn_register_totals(
    p_department text default null,
    p_fy         text default null
) returns jsonb language sql stable as $fn$
    select jsonb_build_object(
        'entries',       count(*),
        'amount',        coalesce(sum(amount), 0),
        'departments',   count(distinct department),
        'financial_year', coalesce(p_fy, public.fn_financial_year())
    )
    from public.purchase_register
    where (p_department is null or department = p_department::public.department)
      and (p_fy is null or financial_year = p_fy);
$fn$;

-- =====================================================================
-- fn_amend_bill
--
-- Correcting a bill that has been sent back on hold.
--
-- If the amount changes, the reservation against the PDA has to move with
-- it -- up or down -- and the new amount has to fit inside what is still
-- free. Doing that as a separate update from the browser, which is how it
-- used to work, could leave the bill saying one thing and the PDA another.
--
-- Only a bill that has not been decided may be amended. The routing is
-- deliberately left alone: a bill that is on hold at Audit stays at Audit,
-- even if the corrected amount would now have skipped that desk. Changing
-- its route mid-flight would erase the fact that Audit had already seen it.
-- =====================================================================
create or replace function public.fn_amend_bill(
    p_bill_id uuid,
    p_payload jsonb,
    p_actor   jsonb
) returns jsonb language plpgsql as $fn$
declare
    v_bill    public.bills%rowtype;
    v_old     numeric;
    v_new     numeric;
    v_delta   numeric;
    v_pda     public.pda_balances%rowtype;
    v_changes text[] := '{}';
begin
    select * into v_bill from public.bills where id = p_bill_id for update;
    if not found then
        raise exception 'No such bill.' using errcode = 'P0001';
    end if;

    if v_bill.status in ('Accepted', 'Rejected') then
        raise exception
            'This bill is already % and can no longer be edited. File a fresh bill instead.',
            lower(v_bill.status) using errcode = 'P0001';
    end if;

    v_old := v_bill.po_value;
    v_new := coalesce(nullif(p_payload->>'po_value', '')::numeric, v_old);

    if v_new <= 0 then
        raise exception 'The bill amount must be greater than zero.' using errcode = 'P0001';
    end if;

    v_delta := v_new - v_old;

    if v_delta <> 0 then
        select * into v_pda from public.pda_balances
            where employee_id = v_bill.employee_id for update;
        if not found then
            raise exception 'No PDA account for "%".', v_bill.employee_id using errcode = 'P0001';
        end if;

        -- Increasing the bill takes more from the free balance; reducing it
        -- gives some back. Either way the reservation follows the bill.
        if v_delta > 0 and v_pda.balance < v_delta then
            raise exception
                'Raising this bill to Rs % needs another Rs %, but only Rs % is free.',
                trim(to_char(v_new,         'FM999999990.00')),
                trim(to_char(v_delta,       'FM999999990.00')),
                trim(to_char(v_pda.balance, 'FM999999990.00'))
                using errcode = 'P0001';
        end if;

        update public.pda_balances
           set balance    = balance   - v_delta,
               committed  = committed + v_delta,
               updated_at = now()
         where employee_id = v_bill.employee_id;

        v_changes := v_changes || format('amount %s -> %s',
            trim(to_char(v_old, 'FM999999990.00')),
            trim(to_char(v_new, 'FM999999990.00')));
    end if;

    update public.bills set
        po_value         = v_new,
        po_details       = coalesce(nullif(btrim(p_payload->>'po_details'), ''),       po_details),
        supplier_name    = coalesce(nullif(btrim(p_payload->>'supplier_name'), ''),    supplier_name),
        supplier_address = coalesce(nullif(btrim(p_payload->>'supplier_address'), ''), supplier_address),
        item_description = coalesce(nullif(btrim(p_payload->>'item_description'), ''), item_description),
        item_category    = coalesce(nullif(btrim(p_payload->>'item_category'), ''),    item_category),
        qty              = coalesce(nullif(p_payload->>'qty', '')::integer,            qty),
        qty_issued       = coalesce(nullif(p_payload->>'qty_issued', '')::integer,     qty_issued),
        bill_details     = coalesce(nullif(btrim(p_payload->>'bill_details'), ''),     bill_details),
        indenter_name    = coalesce(nullif(btrim(p_payload->>'indenter_name'), ''),    indenter_name),
        source_of_fund   = coalesce(nullif(btrim(p_payload->>'source_of_fund'), ''),   source_of_fund),
        stock_entry      = coalesce(nullif(btrim(p_payload->>'stock_entry'), ''),      stock_entry),
        location         = coalesce(nullif(btrim(p_payload->>'location'), ''),         location),
        -- A corrected bill goes back into the queue at the desk holding it.
        snp              = case when status = 'Student Purchase' and snp           = 'Hold' then 'Pending' else snp           end,
        audit            = case when status = 'Audit'            and audit         = 'Hold' then 'Pending' else audit         end,
        finance_admin    = case when status = 'Finance Admin'    and finance_admin = 'Hold' then 'Pending' else finance_admin end
    where id = p_bill_id
    returning * into v_bill;

    perform public.fn_log_event(
        p_bill_id, 'Applicant', 'Forwarded',
        p_actor->>'code', p_actor->>'name', p_actor->>'role',
        case
          when array_length(v_changes, 1) is null
            then 'Bill details corrected and resubmitted.'
          else 'Bill corrected and resubmitted (' || array_to_string(v_changes, ', ') || ').'
        end,
        v_bill.status, v_bill.status, v_new
    );

    return to_jsonb(v_bill);
end;
$fn$;


-- ###################################################################
-- supabase/seed/0003_demo_data.sql
-- ###################################################################

-- =====================================================================
-- 0003_demo_data.sql  --  realistic IIT Mandi demo dataset
--
-- Bills are not inserted directly. Every one is filed through
-- fn_submit_bill and pushed along with fn_bill_action, so the PDA
-- balances, the event log and the purchase register are all genuine
-- consequences of the workflow rather than invented rows.
--
-- Timestamps are back-dated afterwards to spread the data over the last
-- six months. That is the one place the append-only triggers are lifted,
-- and only for the duration of this script.
--
-- Safe to re-run: it clears the transactional tables first.
-- =====================================================================

begin;

-- ---------------------------------------------------------------- reset
alter table public.bill_approvals    disable trigger bill_approvals_append_only;
alter table public.purchase_register disable trigger purchase_register_append_only;

truncate public.purchase_register, public.bill_approvals, public.bills restart identity cascade;
delete from public.pda_balances;
delete from public.employees;
delete from public.counters;

-- ---------------------------------------------------------------- staff
-- The people who run the workflow. Codes follow one scheme throughout:
--   F####  faculty      D##/S##/B##  research / masters / undergrad
--   ADM### administrative staff
insert into public.employees (employee_code, employee_name, email, department, employee_type) values
  ('ADM001', 'Prof. Ramesh Chandra Deka', 'dean.finance@iitmandi.ac.in',   'Deans',                          'Dean'),
  ('ADM010', 'Sanjay Kaul',               'sanjay.kaul@iitmandi.ac.in',    'Finance and Accounts',           'Finance Admin'),
  ('ADM011', 'Pooja Thakur',              'pooja.thakur@iitmandi.ac.in',   'Finance and Accounts',           'Finance Admin'),
  ('ADM020', 'Neha Gupta',                'neha.gupta@iitmandi.ac.in',     'Internal Audit',                 'Audit'),
  ('ADM021', 'Vikram Bhardwaj',           'vikram.b@iitmandi.ac.in',       'Internal Audit',                 'Audit'),
  ('ADM030', 'Rakesh Verma',              'rakesh.verma@iitmandi.ac.in',   'Store and Purchase Section',     'Student Purchase'),
  ('ADM031', 'Anjali Rana',               'anjali.rana@iitmandi.ac.in',    'Store and Purchase Section',     'Student Purchase'),
  ('ADM040', 'Suresh Kumar',              'suresh.kumar@iitmandi.ac.in',   'Finance and Accounts',           'PDA Manager'),
  ('ADM041', 'Kavita Sharma',             'kavita.sharma@iitmandi.ac.in',  'Finance and Accounts',           'PDA Manager'),
  ('ADM050', 'Deepak Negi',               'deepak.negi@iitmandi.ac.in',    'Store and Purchase Section',     'Bill Employee'),
  ('ADM051', 'Shalini Kaushik',           'shalini.k@iitmandi.ac.in',      'Academics Section',              'Bill Employee'),
  ('ADM052', 'Mohit Guleria',             'mohit.guleria@iitmandi.ac.in',  'Registrar Office',               'Bill Employee'),
  ('ADM060', 'Ritu Chauhan',              'ritu.chauhan@iitmandi.ac.in',   'Store and Purchase Section',     'Bill Editor');

-- ------------------------------------------------- faculty and students
do $$
declare
    v_schools text[] := array[
        'School of Computing & Electrical Engineering',
        'School of Chemical Sciences',
        'School of Physical Sciences',
        'School of Mathematical & Statistical Sciences',
        'School of Biosciences & Bio Engineering',
        'School of Mechanical & Materials Engineering',
        'School of Civil & Environmental Engineering',
        'School of Humanities & Social Sciences',
        'School of Management'
    ];
    v_first text[] := array['Aarav','Ishita','Rohan','Ananya','Karthik','Meera','Siddharth','Nandini',
                            'Aditya','Shreya','Vivek','Tanvi','Arjun','Divya','Harsh','Pallavi',
                            'Nikhil','Sneha','Rahul','Kritika','Manav','Aishwarya','Yash','Prerna',
                            'Gaurav','Ritika','Abhishek','Swati','Varun','Neelam'];
    v_last  text[] := array['Sharma','Thakur','Negi','Rao','Iyer','Bhat','Chauhan','Verma','Kapoor',
                            'Guleria','Sood','Mehta','Nair','Joshi','Rathore'];
    i integer;
    v_code text;
    v_name text;
    v_dept public.department;
    v_alloc numeric;
begin
    perform setseed(0.42);   -- deterministic: the same demo data every time

    -- 10 faculty, generous PDA
    for i in 1..10 loop
        v_code := 'F' || lpad((1200 + i)::text, 4, '0');
        v_name := 'Dr. ' || v_first[1 + (i * 3) % array_length(v_first,1)]
                          || ' ' || v_last[1 + (i * 5) % array_length(v_last,1)];
        v_dept := v_schools[1 + (i - 1) % array_length(v_schools,1)]::public.department;
        v_alloc := (400000 + floor(random() * 15) * 50000)::numeric(12,2);

        insert into public.employees (employee_code, employee_name, email, department, employee_type)
        values (v_code, v_name, lower(v_code) || '@iitmandi.ac.in', v_dept, 'User');
        insert into public.pda_balances (employee_id, email, department, allocated, balance)
        values (v_code, lower(v_code) || '@iitmandi.ac.in', v_dept, v_alloc, v_alloc);
    end loop;

    -- 12 PhD scholars
    for i in 1..12 loop
        v_code := 'D' || (21 + i % 4)::text || lpad((100 + i)::text, 3, '0');
        v_name := v_first[1 + (i * 7) % array_length(v_first,1)]
                  || ' ' || v_last[1 + (i * 2) % array_length(v_last,1)];
        v_dept := v_schools[1 + (i + 2) % array_length(v_schools,1)]::public.department;
        v_alloc := (120000 + floor(random() * 9) * 20000)::numeric(12,2);

        insert into public.employees (employee_code, employee_name, email, department, employee_type)
        values (v_code, v_name, lower(v_code) || '@students.iitmandi.ac.in', v_dept, 'User');
        insert into public.pda_balances (employee_id, email, department, allocated, balance)
        values (v_code, lower(v_code) || '@students.iitmandi.ac.in', v_dept, v_alloc, v_alloc);
    end loop;

    -- 8 masters students
    for i in 1..8 loop
        v_code := 'S' || (23 + i % 2)::text || lpad((200 + i)::text, 3, '0');
        v_name := v_first[1 + (i * 11) % array_length(v_first,1)]
                  || ' ' || v_last[1 + (i * 4) % array_length(v_last,1)];
        v_dept := v_schools[1 + (i + 5) % array_length(v_schools,1)]::public.department;
        v_alloc := (60000 + floor(random() * 7) * 10000)::numeric(12,2);

        insert into public.employees (employee_code, employee_name, email, department, employee_type)
        values (v_code, v_name, lower(v_code) || '@students.iitmandi.ac.in', v_dept, 'User');
        insert into public.pda_balances (employee_id, email, department, allocated, balance)
        values (v_code, lower(v_code) || '@students.iitmandi.ac.in', v_dept, v_alloc, v_alloc);
    end loop;
end $$;

-- The staff who run the workflow also hold small PDAs of their own.
insert into public.pda_balances (employee_id, email, department, allocated, balance)
select employee_code, email, department, 150000, 150000
from public.employees
where employee_type in ('Bill Employee', 'Bill Editor', 'Student Purchase', 'Audit');

-- ---------------------------------------------------------------- bills
do $$
declare
    v_items_major text[] := array[
        'Keysight DSOX1204G oscilloscope',
        'Fume hood with scrubber unit',
        'Thermo Scientific centrifuge, refrigerated',
        'CNC benchtop milling machine',
        'Rotary vacuum pump, two stage',
        'Server node, 2x Xeon Silver, 256 GB RAM',
        'Universal testing machine, 50 kN',
        'Confocal microscope objective set',
        'Environmental chamber, 150 L',
        'GPU workstation, RTX A5000'];
    v_items_minor text[] := array[
        'Soldering station, temperature controlled',
        'Digital vernier calliper set',
        'Laboratory hot plate with magnetic stirrer',
        'Precision weighing balance, 0.1 mg',
        'Tripod and camera mount for field survey',
        'Portable spectrum analyser',
        'Ultrasonic cleaner, 6 L',
        'Benchtop pH meter with electrodes',
        'Hand-held thermal imager',
        'Network switch, 24 port managed'];
    v_items_cons text[] := array[
        'Nitrile examination gloves, 20 boxes',
        'Analytical grade acetonitrile, 5 L',
        'Printer toner cartridges, set of 4',
        'Borosilicate glassware replacement set',
        'A4 paper, 30 reams',
        'Pipette tips, sterile, 10 racks',
        'Silica gel desiccant, 25 kg',
        'Chart recorder paper and pens',
        'Copper clad laminate sheets, 20 nos',
        'Distilled water, 50 L'];
    v_suppliers text[] := array[
        'Scientific Traders, Mandi',
        'Himalayan Lab Supplies, Shimla',
        'Precision Instruments Pvt Ltd, Chandigarh',
        'Northern Scientific Corporation, New Delhi',
        'Agilent Technologies India',
        'Spectra Chem Agencies, Ludhiana',
        'Kamla Enterprises, Mandi',
        'TechnoSource Systems, Noida',
        'Bharat Lab Equipments, Ambala',
        'Shivalik Traders, Sundernagar'];
    v_addr text[] := array[
        'Bhutti Colony, Mandi, Himachal Pradesh 175001',
        'The Mall, Shimla, Himachal Pradesh 171001',
        'Industrial Area Phase II, Chandigarh 160002',
        'Karol Bagh, New Delhi 110005',
        'Sector 62, Noida, Uttar Pradesh 201309'];
    v_funds text[] := array['Institute Plan Fund','SERB Core Research Grant','DST Project Grant',
                            'Institute Development Fund','CSIR Sponsored Project','PDA'];
    v_locations text[] := array['North Campus, Kamand','South Campus, Kamand','Mandi City Campus',
                                'A-11 Laboratory Block','Central Instrumentation Facility'];

    v_holders   text[];
    v_snp       text[] := array['ADM030','ADM031'];
    v_auditors  text[] := array['ADM020','ADM021'];
    v_finance   text[] := array['ADM010','ADM011'];
    v_filers    text[] := array['ADM050','ADM051','ADM052'];

    v_holder    text;
    v_actor     text;
    v_actor_nm  text;
    v_bill      jsonb;
    v_id        uuid;
    v_cat       text;
    v_stage     text;
    v_amount    numeric;
    v_item      text;
    v_avail     numeric;
    v_created   timestamptz;
    v_cursor    timestamptz;
    v_roll      numeric;
    v_made      integer := 0;
    i           integer;

    v_reject_reasons text[] := array[
        'Quotation is not from a GeM-registered vendor. Please re-tender.',
        'Sanction letter for the funding head is not attached.',
        'The rate quoted exceeds the DGS&D contract rate for this item.',
        'Stock entry number is missing; the item cannot be taken on charge.',
        'Three comparative quotations are required above this value.'];
    v_hold_reasons text[] := array[
        'Awaiting the indenter''s signature on the stock entry.',
        'Please attach the delivery challan before this can proceed.',
        'Held pending clarification on the warranty period.',
        'Budget head confirmation awaited from the project PI.'];
begin
    perform setseed(0.7);

    select array_agg(employee_id order by employee_id) into v_holders
      from public.pda_balances;

    for i in 1..165 loop
        v_holder := v_holders[1 + floor(random() * array_length(v_holders,1))::int];

        select balance into v_avail from public.pda_balances where employee_id = v_holder;
        if v_avail is null or v_avail < 3000 then
            continue;   -- this holder is tapped out; skip
        end if;

        -- category mix roughly matches a real school: mostly small purchases
        v_roll := random();
        if v_roll < 0.45 then
            v_cat  := 'Consumables';
            v_item := v_items_cons[1 + floor(random() * 10)::int];
            v_amount := (2000 + floor(random() * 60) * 1000)::numeric;
        elsif v_roll < 0.80 then
            v_cat  := 'Minor';
            v_item := v_items_minor[1 + floor(random() * 10)::int];
            v_amount := (8000 + floor(random() * 70) * 1000)::numeric;
        else
            v_cat  := 'Major';
            v_item := v_items_major[1 + floor(random() * 10)::int];
            v_amount := (50000 + floor(random() * 40) * 5000)::numeric;
        end if;

        if v_amount > v_avail then
            v_amount := floor(v_avail / 1000) * 1000;
        end if;
        continue when v_amount < 1000;

        v_created := now() - (random() * interval '180 days');
        v_actor   := v_filers[1 + floor(random() * 3)::int];

        v_bill := public.fn_submit_bill(
            jsonb_build_object(
                'employee_id',      v_holder,
                'po_value',         v_amount,
                'item_category',    v_cat,
                'item_description', v_item,
                'qty',              (1 + floor(random() * 5))::int,
                'qty_issued',       (1 + floor(random() * 5))::int,
                'po_details',       'PO/' || to_char(v_created,'YYYY') || '/' || lpad((1000 + i)::text,4,'0'),
                'supplier_name',    v_suppliers[1 + floor(random() * 10)::int],
                'supplier_address', v_addr[1 + floor(random() * 5)::int],
                'source_of_fund',   v_funds[1 + floor(random() * 6)::int],
                'location',         v_locations[1 + floor(random() * 5)::int],
                'stock_entry',      'SE/' || lpad((500 + i)::text,4,'0'),
                'indenter_name',    (select employee_name from public.employees where employee_code = v_holder),
                'bill_details',     'Invoice ' || lpad((7000 + i)::text,5,'0')
                                    || ' dated ' || to_char(v_created,'DD.MM.YYYY')
            ),
            jsonb_build_object('code', v_actor, 'role', 'Bill Employee',
                'name', (select employee_name from public.employees where employee_code = v_actor)));

        v_id      := (v_bill->>'id')::uuid;
        v_cursor  := v_created;
        v_made    := v_made + 1;

        -- Now walk it forward. ~15% of bills are left sitting where they are.
        <<walk>>
        loop
            exit walk when random() < 0.15;

            select status into v_stage from public.bills where id = v_id;
            exit walk when v_stage in ('Accepted','Rejected');

            v_cursor := v_cursor + (interval '1 day' * (1 + random() * 6));
            exit walk when v_cursor > now();

            v_actor := case v_stage
                when 'Student Purchase' then v_snp[1 + floor(random() * 2)::int]
                when 'Audit'            then v_auditors[1 + floor(random() * 2)::int]
                else                         v_finance[1 + floor(random() * 2)::int]
            end;
            select employee_name into v_actor_nm from public.employees where employee_code = v_actor;

            v_roll := random();
            if v_roll < 0.10 then
                perform public.fn_bill_action(v_id, v_actor, v_actor_nm, v_stage, 'Rejected',
                    v_reject_reasons[1 + floor(random() * 5)::int]);
                exit walk;
            elsif v_roll < 0.18 then
                perform public.fn_bill_action(v_id, v_actor, v_actor_nm, v_stage, 'Hold',
                    v_hold_reasons[1 + floor(random() * 4)::int]);
                -- a held bill usually clears a few days later
                if random() < 0.6 then
                    v_cursor := v_cursor + (interval '1 day' * (1 + random() * 5));
                    exit walk when v_cursor > now();
                    perform public.fn_bill_action(v_id, v_actor, v_actor_nm, v_stage, 'Approved',
                        'Clarification received. Cleared.',
                        case when v_stage = 'Student Purchase' and random() < 0.35
                             then jsonb_build_object('has_bank_guarantee', true,
                                    'bank_guarantee_details','BG/PNB/'||to_char(v_cursor,'YYYY')||'/'||lpad((100+i)::text,3,'0'),
                                    'bank_guarantee_amount', round(v_amount * 0.1)::text)
                             else '{}'::jsonb end);
                else
                    exit walk;
                end if;
            else
                perform public.fn_bill_action(v_id, v_actor, v_actor_nm, v_stage, 'Approved',
                    case v_stage
                      when 'Student Purchase' then 'Verified against the indent and the store record.'
                      when 'Audit'            then 'Rates and sanction verified. In order.'
                      else                         'Passed for payment.'
                    end,
                    case when v_stage = 'Student Purchase' and random() < 0.35
                         then jsonb_build_object('has_bank_guarantee', true,
                                'bank_guarantee_details','BG/SBI/'||to_char(v_cursor,'YYYY')||'/'||lpad((100+i)::text,3,'0'),
                                'bank_guarantee_amount', round(v_amount * 0.1)::text,
                                'date_of_delivery', (v_cursor + interval '14 days')::text,
                                'date_of_installation', (v_cursor + interval '21 days')::text)
                         else '{}'::jsonb end);
            end if;
        end loop walk;

        -- Back-date the whole trail so the demo looks lived-in.
        update public.bills set created_at = v_created,
               decided_at = case when decided_at is not null then v_cursor end,
               updated_at = greatest(v_created, v_cursor)
         where id = v_id;

        update public.bill_approvals a
           set created_at = v_created + (interval '1 day' * (a.seq - 1) * 1.5)
         where a.bill_id = v_id;

        update public.purchase_register
           set recorded_at = v_cursor, entry_date = v_cursor::date
         where bill_id = v_id;
    end loop;

    raise notice 'seeded % bills', v_made;
end $$;

-- ------------------------------------------------------- demo logins
-- These are the fixed accounts the login page accepts with password "123"
-- while the portal is running off the institute network. Every one of them
-- resolves to a real row here, so the role always comes from the database.
-- Remove this block, and DEMO_LOGIN_ENABLED, for the production deploy.
insert into public.employees (employee_code, employee_name, email, department, employee_type) values
  ('Dean',          'Demo Dean of Finance',  'demo.dean@iitmandi.ac.in',    'Deans',                      'Dean'),
  ('Finance Admin', 'Demo Finance Admin',    'demo.finance@iitmandi.ac.in', 'Finance and Accounts',       'Finance Admin'),
  ('Audit',         'Demo Auditor',          'demo.audit@iitmandi.ac.in',   'Internal Audit',             'Audit'),
  ('SNP',           'Demo Store & Purchase', 'demo.snp@iitmandi.ac.in',     'Store and Purchase Section', 'Student Purchase'),
  ('Bill-form',     'Demo Bill Filer',       'demo.billform@iitmandi.ac.in','Store and Purchase Section', 'Bill Employee'),
  ('Bill-edit',     'Demo Bill Editor',      'demo.billedit@iitmandi.ac.in','Store and Purchase Section', 'Bill Editor'),
  ('pda manager',   'Demo PDA Manager',      'demo.pda@iitmandi.ac.in',     'Finance and Accounts',       'PDA Manager'),
  ('User',          'Demo User',             'demo.user@iitmandi.ac.in',    'School of Computing & Electrical Engineering', 'User'),
  ('E001', 'Aarav Sharma',   'e001@students.iitmandi.ac.in', 'School of Computing & Electrical Engineering',  'User'),
  ('E002', 'Ishita Rao',     'e002@students.iitmandi.ac.in', 'School of Chemical Sciences',                   'User'),
  ('E003', 'Rohan Negi',     'e003@students.iitmandi.ac.in', 'School of Physical Sciences',                   'User'),
  ('E004', 'Ananya Iyer',    'e004@students.iitmandi.ac.in', 'School of Biosciences & Bio Engineering',       'User'),
  ('E005', 'Karthik Bhat',   'e005@students.iitmandi.ac.in', 'School of Mechanical & Materials Engineering',  'User'),
  ('E006', 'Meera Chauhan',  'e006@students.iitmandi.ac.in', 'School of Civil & Environmental Engineering',   'User'),
  ('E007', 'Siddharth Sood', 'e007@students.iitmandi.ac.in', 'School of Mathematical & Statistical Sciences', 'User'),
  ('E008', 'Nandini Kapoor', 'e008@students.iitmandi.ac.in', 'School of Humanities & Social Sciences',        'User');

-- Give the demo users something to spend, and the demo staff a PDA too.
insert into public.pda_balances (employee_id, email, department, allocated, balance)
select employee_code, email, department, 250000, 250000
from public.employees
where employee_code in ('User','E001','E002','E003','E004','E005','E006','E007','E008',
                        'Bill-form','Bill-edit','SNP','Audit','Finance Admin','pda manager','Dean');

-- Put a few live bills on the demo users so their pages are not empty.
do $$
declare v_codes text[] := array['E001','E002','E003','User'];
        v_id uuid; v_bill jsonb; c text; i integer;
        v_stage text; v_actor text; v_actor_nm text;
begin
    perform setseed(0.9);
    foreach c in array v_codes loop
        for i in 1..4 loop
            v_bill := public.fn_submit_bill(
                jsonb_build_object(
                    'employee_id', c,
                    'po_value', (5000 + i * 17000)::numeric,
                    'item_category', (array['Consumables','Minor','Major','Minor'])[i],
                    'item_description', (array['Pipette tips, sterile, 10 racks',
                                               'Benchtop pH meter with electrodes',
                                               'GPU workstation, RTX A5000',
                                               'Digital vernier calliper set'])[i],
                    'qty', i,
                    'supplier_name', 'Scientific Traders, Mandi',
                    'supplier_address', 'Bhutti Colony, Mandi, Himachal Pradesh 175001',
                    'source_of_fund', 'Institute Plan Fund',
                    'location', 'North Campus, Kamand',
                    'stock_entry', 'SE/DEMO/' || i,
                    'po_details', 'PO/DEMO/' || c || '/' || i,
                    'indenter_name', (select employee_name from public.employees where employee_code = c)),
                '{"code":"Bill-form","name":"Demo Bill Filer","role":"Bill Employee"}'::jsonb);
            v_id := (v_bill->>'id')::uuid;

            -- leave #1 where it lands, approve #2 all the way, reject #3
            -- Each desk is worked by somebody who actually holds that role,
            -- so the demo timeline reads the way a real one would.
            if i = 2 then
                loop
                    select status into v_stage from public.bills where id = v_id;
                    exit when v_stage in ('Accepted', 'Rejected');

                    select employee_code, employee_name into v_actor, v_actor_nm
                      from public.employees
                     where employee_type = v_stage and employee_code like 'ADM%'
                     order by employee_code limit 1;

                    perform public.fn_bill_action(v_id, v_actor, v_actor_nm, v_stage,
                        'Approved',
                        case v_stage
                          when 'Student Purchase' then 'Verified against the indent and the store record.'
                          when 'Audit'            then 'Rates and sanction verified. In order.'
                          else                         'Passed for payment.'
                        end);
                end loop;

            elsif i = 3 then
                select status into v_stage from public.bills where id = v_id;
                select employee_code, employee_name into v_actor, v_actor_nm
                  from public.employees
                 where employee_type = v_stage and employee_code like 'ADM%'
                 order by employee_code limit 1;

                perform public.fn_bill_action(v_id, v_actor, v_actor_nm, v_stage, 'Rejected',
                    'Three comparative quotations are required above this value.');
            end if;
        end loop;
    end loop;
end $$;

-- ---------------------------------------------------------------- restore
alter table public.bill_approvals    enable trigger bill_approvals_append_only;
alter table public.purchase_register enable trigger purchase_register_append_only;

commit;

-- ---------------------------------------------------------------- summary
select 'employees' as table, count(*) from public.employees
union all select 'pda accounts',       count(*) from public.pda_balances
union all select 'bills',              count(*) from public.bills
union all select 'workflow events',    count(*) from public.bill_approvals
union all select 'register entries',   count(*) from public.purchase_register;

select status, count(*), to_char(sum(po_value),'FM99,99,99,990') as total_rs
from public.bills group by status order by count(*) desc;

select 'PDA invariant holds' as check,
       (count(*) = 0) as ok
from public.pda_balances where allocated <> balance + committed + spent;
