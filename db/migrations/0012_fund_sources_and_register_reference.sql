-- =====================================================================
-- 0012_fund_sources_and_register_reference.sql
--
-- Two changes to bill filing.
--
-- 1. Sources of fund become a master that the Dean's office controls.
--    Until now PDA, OH-31 and OH-35 were hard-wired into CHECK constraints
--    and functions. fund_sources lists every source a bill may be charged
--    to; the Dean approves new ones (and may switch a source off), and the
--    bill form offers exactly the active ones.
--
--    A new source is a real budget head, just like OH-31 and OH-35: the
--    Dean sanctions money to it each financial year, a bill reserves it
--    when filed, releases it back on rejection and spends it on final
--    approval, all in the existing fund_heads ledger. Nothing can be
--    charged to a source that has no sanctioned money. PDA stays the
--    applicant's personal account.
--
--    The three existing sources are seeded as built-ins and cannot be
--    switched off, so no existing bill, balance or register entry changes.
--
-- 2. A bill records where it was entered in the physical registers that
--    have not yet moved to the database: register name, page number and
--    serial number. They are mandatory on every new or corrected bill.
--    The values live in bills.form_data (as for every other form field)
--    and are copied into three plain columns so they can be searched,
--    listed on the purchase register and exported. Older bills keep nulls.
--
-- Additive and repeatable. Run after 0011; repeat upgrades must end here.
-- =====================================================================
begin;
select pg_advisory_xact_lock(hashtext('ifmp:integrity-migration'));

-- ---------------------------------------------------------------------
-- 1. fund_sources
-- ---------------------------------------------------------------------
create table if not exists public.fund_sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
  description text not null check (btrim(description) <> '' and length(description) <= 120),
  group_name text not null default 'Other sources of fund' check (btrim(group_name) <> '' and length(group_name) <= 80),
  -- 'pda' is the applicant's personal account; 'budget' is an institute head with its own sanctions.
  kind text not null check (kind in ('pda', 'budget')),
  categories text[] not null default array['Consumables', 'Minor', 'Major']
    check (cardinality(categories) > 0 and categories <@ array['Consumables', 'Minor', 'Major']),
  is_builtin boolean not null default false,
  is_active boolean not null default true,
  approved_by text,
  approved_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.fund_sources (code, description, group_name, kind, categories, is_builtin) values
  ('OH-31', 'General (recurring)', 'Institute budget heads', 'budget', array['Consumables', 'Minor'], true),
  ('OH-35', 'Capital assets', 'Institute budget heads', 'budget', array['Minor', 'Major'], true),
  ('PDA', 'Applicant''s PDA', 'Personal Development Account', 'pda', array['Consumables', 'Minor', 'Major'], true)
on conflict (code) do nothing;

drop trigger if exists fund_sources_change_log on public.fund_sources;
create trigger fund_sources_change_log after insert or update or delete on public.fund_sources
for each row execute function public.fn_change_log();

-- A source is never deleted: bills, ledgers and registers name it for good.
create or replace function public.fn_fund_source_guard() returns trigger language plpgsql as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'A source of fund cannot be deleted. Switch it off instead.';
  end if;
  if new.code <> old.code or new.kind <> old.kind or new.is_builtin <> old.is_builtin then
    raise exception 'The code and type of a source of fund cannot change.';
  end if;
  if old.is_builtin and not new.is_active then
    raise exception '% is a standing source of fund and cannot be switched off.', old.code;
  end if;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists fund_sources_guard on public.fund_sources;
create trigger fund_sources_guard before update or delete on public.fund_sources
for each row execute function public.fn_fund_source_guard();

-- The Dean approves a new source of fund. It starts with no money: sanction
-- some on its register before a bill can be charged to it.
create or replace function public.fn_add_fund_source(
  p_code text, p_description text, p_group text, p_categories text[], p_actor text
) returns jsonb language plpgsql as $$
declare s public.fund_sources%rowtype; v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if not exists (select 1 from public.employees where employee_code = p_actor and is_active and employee_type = 'Dean') then
    raise exception 'Only the Dean can approve a source of fund.';
  end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{1,19}$' then
    raise exception 'Use 2 to 20 capital letters, digits or hyphens for the code, for example OH-36 or SRIC-GRANT.';
  end if;
  if coalesce(btrim(p_description), '') = '' or length(btrim(p_description)) > 120 then
    raise exception 'Describe the source of fund in up to 120 characters.';
  end if;
  if exists (select 1 from public.fund_sources where code = v_code) then
    raise exception '% is already a source of fund.', v_code;
  end if;
  perform set_config('app.actor_code', p_actor, true);
  insert into public.fund_sources (code, description, group_name, kind, categories, approved_by)
  values (v_code, btrim(p_description), coalesce(nullif(btrim(p_group), ''), 'Other sources of fund'), 'budget',
          coalesce(p_categories, array['Consumables', 'Minor', 'Major']), p_actor)
  returning * into s;
  return to_jsonb(s);
end; $$;

create or replace function public.fn_set_fund_source_active(p_code text, p_active boolean, p_actor text)
returns jsonb language plpgsql as $$
declare s public.fund_sources%rowtype;
begin
  if not exists (select 1 from public.employees where employee_code = p_actor and is_active and employee_type = 'Dean') then
    raise exception 'Only the Dean can switch a source of fund on or off.';
  end if;
  perform set_config('app.actor_code', p_actor, true);
  update public.fund_sources set is_active = p_active where code = p_code returning * into s;
  if not found then raise exception 'No source of fund "%".', p_code; end if;
  return to_jsonb(s);
end; $$;

-- ---------------------------------------------------------------------
-- Budget heads and bill pools are no longer limited to OH-31 / OH-35
-- ---------------------------------------------------------------------
alter table public.fund_heads drop constraint if exists fund_heads_code_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fund_heads_code_fk') then
    alter table public.fund_heads add constraint fund_heads_code_fk
      foreign key (code) references public.fund_sources(code);
  end if;
end $$;

alter table public.bills drop constraint if exists bills_funding_pool_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bills_funding_pool_fk') then
    alter table public.bills add constraint bills_funding_pool_fk
      foreign key (funding_pool) references public.fund_sources(code);
  end if;
end $$;

-- The pool a source draws on: PDA, or the source's own budget head.
create or replace function public.fn_pool_for(p_fund text) returns text
language sql stable as $$
  select case when exists (select 1 from public.fund_sources where code = p_fund and kind = 'budget')
              then p_fund else 'PDA' end
$$;

-- Money is sanctioned only to an approved, active budget head.
create or replace function public.fn_add_fund_allocation(
  p_code text, p_fy text, p_amount numeric, p_reference text, p_date date, p_remarks text, p_actor text
) returns jsonb language plpgsql as $$
declare h public.fund_heads%rowtype;
begin
  if not exists (select 1 from public.employees where employee_code = p_actor and is_active and employee_type = 'Dean') then
    raise exception 'Only the Dean can allocate budget-head funds.';
  end if;
  if not exists (select 1 from public.fund_sources where code = p_code and kind = 'budget' and is_active) then
    raise exception 'Choose an approved, active budget head such as OH-31 or OH-35.';
  end if;
  if p_fy is null or p_fy !~ '^\d{4}-\d{2}$' then raise exception 'Choose a financial year such as 2026-27.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount >= 1e12 or p_amount <> round(p_amount, 2) then
    raise exception 'Enter a positive amount with at most two decimal places.';
  end if;
  if coalesce(btrim(p_reference), '') = '' then raise exception 'Enter the sanction letter or order reference.'; end if;
  perform set_config('app.actor_code', p_actor, true);
  insert into public.fund_heads(code, financial_year) values (p_code, p_fy) on conflict (code, financial_year) do nothing;
  select * into h from public.fund_heads where code = p_code and financial_year = p_fy for update;
  update public.fund_heads set allocated = allocated + p_amount, balance = balance + p_amount, updated_at = now()
    where id = h.id returning * into h;
  insert into public.fund_head_entries(fund_head_id, code, financial_year, kind, amount, reference, entry_date, remarks, actor_code)
  values (h.id, h.code, h.financial_year, 'Allocation', p_amount, btrim(p_reference),
    coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date), nullif(btrim(coalesce(p_remarks, '')), ''), p_actor);
  return to_jsonb(h);
end; $$;

-- The source must be an approved, active one, and suit the item category.
-- OH-31 / OH-35 keep their original wording; any other source follows the
-- categories the Dean approved it for.
create or replace function public.fn_validate_fund(p jsonb) returns void language plpgsql as $$
declare s public.fund_sources%rowtype; v_code text := nullif(btrim(p->>'source_of_fund'), ''); v_cat text := p->>'item_category';
begin
  if v_code is null then raise exception 'Choose the source of fund.'; end if;
  select * into s from public.fund_sources where code = v_code;
  if not found then raise exception '"%" is not an approved source of fund.', v_code; end if;
  if not s.is_active then raise exception '% is not an approved source of fund at present. Choose another.', v_code; end if;
  if v_cat = any (s.categories) then return; end if;
  if v_code = 'OH-35' and v_cat = 'Consumables' then
    raise exception 'OH-35 is for creation of capital assets. Charge consumables to OH-31 or the PDA.';
  elsif v_code = 'OH-31' and v_cat = 'Major' then
    raise exception 'OH-31 is the general (recurring) head. Charge major equipment to OH-35 or the PDA.';
  end if;
  raise exception '% cannot be charged for % purchases.', v_code, lower(v_cat);
end; $$;

-- ---------------------------------------------------------------------
-- 2. Where the bill was entered in the physical registers
-- ---------------------------------------------------------------------
alter table public.bills add column if not exists register_name text;
alter table public.bills add column if not exists register_page text;
alter table public.bills add column if not exists register_serial text;

-- Fires after bills_revision, which sets form_data on a new bill, and on
-- every correction, so the columns always match the form. A bill filed
-- before this migration has no form_data and keeps nulls.
create or replace function public.fn_bill_register_reference() returns trigger language plpgsql as $$
begin
  if jsonb_typeof(new.form_data) = 'object' then
    new.register_name := nullif(btrim(new.form_data->>'registerName'), '');
    new.register_page := nullif(btrim(new.form_data->>'registerPage'), '');
    new.register_serial := nullif(btrim(new.form_data->>'registerSerial'), '');
  end if;
  return new;
end; $$;
drop trigger if exists bills_sync_register_ref on public.bills;
create trigger bills_sync_register_ref before insert or update on public.bills
for each row execute function public.fn_bill_register_reference();

-- Bill validation as in 0005, with two changes: the source of fund is no
-- longer limited to OH-31 / OH-35 / PDA (fn_validate_fund checks it against
-- fund_sources), and the three register entries are mandatory.
create or replace function public.fn_validate_bill(p jsonb) returns void language plpgsql as $$
declare total numeric; line jsonb; q integer; issued integer; price numeric; purchase numeric;
  invoice_day date; delivery_day date; installation_day date;
begin
  -- Where the purchase was entered in the physical registers: mandatory on every new or corrected bill.
  if jsonb_typeof(p->'form_data') = 'object' then
    if coalesce(btrim(p->'form_data'->>'registerName'), '') = '' or length(btrim(p->'form_data'->>'registerName')) > 100 then
      raise exception 'Enter the name of the register this purchase was entered in (up to 100 characters).';
    end if;
    if coalesce(btrim(p->'form_data'->>'registerPage'), '') = '' or length(btrim(p->'form_data'->>'registerPage')) > 50 then
      raise exception 'Enter the page number of that register entry (up to 50 characters).';
    end if;
    if coalesce(btrim(p->'form_data'->>'registerSerial'), '') = '' or length(btrim(p->'form_data'->>'registerSerial')) > 50 then
      raise exception 'Enter the serial number of that register entry (up to 50 characters).';
    end if;
  end if;
  if jsonb_typeof(p->'form_data') is distinct from 'object'
    or jsonb_typeof(p->'form_data'->'lines') is distinct from 'array'
    or jsonb_array_length(p->'form_data'->'lines') not between 1 and 100
    or p->'form_data'->>'declaration' is distinct from 'true'
    or p->'form_data'->>'totalConfirmed' is distinct from 'true'
    or p->'form_data'->>'delivered' is distinct from 'yes'
    or coalesce(p->>'item_category','') not in ('Major','Minor','Consumables')
    or coalesce(btrim(p->>'source_of_fund'), '') = ''
    or coalesce(btrim(p->>'supplier_name'), '') = ''
    or coalesce(btrim(p->>'supplier_address'), '') = ''
    or coalesce(btrim(p->>'invoice_no'), '') = ''
    or coalesce(btrim(p->>'item_description'), '') = ''
    or coalesce((p->>'qty')::integer, 0) <= 0
    or p->>'qty_issued' is null or (p->>'qty_issued')::integer not between 0 and (p->>'qty')::integer
    or p->>'invoice_date' is null or p->>'date_of_delivery' is null then
    raise exception 'Incomplete or invalid bill details.';
  end if;
  invoice_day := (p->>'invoice_date')::date;
  delivery_day := (p->>'date_of_delivery')::date;
  if invoice_day > (now() at time zone 'Asia/Kolkata')::date
    or delivery_day > (now() at time zone 'Asia/Kolkata')::date
    or delivery_day < invoice_day then
    raise exception 'Bill date must be on or before delivery; dates cannot be in the future.';
  end if;
  if p->'form_data'->>'installRequired' = 'yes' then
    installation_day := (p->>'date_of_installation')::date;
    if installation_day is null or p->'form_data'->>'installDone' is distinct from 'yes'
      or installation_day < delivery_day or installation_day < invoice_day
      or installation_day > (now() at time zone 'Asia/Kolkata')::date then
      raise exception 'Completed installation must be on or after delivery and the bill date.';
    end if;
  elsif p->'form_data'->>'installRequired' is distinct from 'no' then
    raise exception 'Say whether installation is required.';
  end if;
  if p->'form_data'->>'billDate' is distinct from p->>'invoice_date'
    or p->'form_data'->>'deliveryDate' is distinct from p->>'date_of_delivery'
    or p->'form_data'->>'fund' is distinct from p->>'source_of_fund'
    or p->'form_data'->>'category' is distinct from p->>'item_category'
    or (p->'form_data'->>'installRequired' = 'yes' and p->'form_data'->>'installDate' is distinct from p->>'date_of_installation') then
    raise exception 'Bill fields must match the complete form.';
  end if;
  total := coalesce(nullif(regexp_replace(p->'form_data'->>'otherCharges', '[₹,\s]', '', 'g'),'')::numeric, 0);
  if total < 0 or total >= 'Infinity'::numeric then raise exception 'Invalid other charges.'; end if;
  for line in select value from jsonb_array_elements(p->'form_data'->'lines') loop
    q := (line->>'qty')::integer; issued := (line->>'qtyIssued')::integer;
    price := regexp_replace(line->>'unitPrice', '[₹,\s]', '', 'g')::numeric;
    if q is null or issued is null or price is null or q not between 1 and 999
      or issued not between 0 and q or price <= 0 or price >= 'Infinity'::numeric then
      raise exception 'Invalid item quantities or price.';
    end if;
    if p->>'item_category' = 'Consumables' and (
      coalesce(line->>'group','') not in ('Office and academic stationery','Laboratory chemicals','Laboratory consumables',
        'Scientific materials','Biological consumables','Computer consumables','Electrical and electronic consumables',
        'Mechanical and fabrication consumables','Maintenance consumables','Housekeeping consumables',
        'Water and wastewater treatment consumables','Research-specific consumables','Miscellaneous')
      or line->>'type' in ('Laptop','Notebook','MacBook','Desktop Computer','Monitor','CPU','Refrigerator','AC','Fan')) then
      raise exception 'Choose consumable items, not durable equipment.';
    end if;
    total := total + round(q * price, 2);
  end loop;
  if total <= 0 or total >= 'Infinity'::numeric or total <> (p->>'po_value')::numeric then
    raise exception 'The bill amount must equal the item total and other charges.';
  end if;
  purchase := nullif(regexp_replace(p->'form_data'->>'poValue', '[₹,\s]', '', 'g'),'')::numeric;
  if purchase is null or purchase <= 0 or purchase >= 'Infinity'::numeric
    or purchase <> round(purchase, 2) or purchase <> total then
    raise exception 'Bill total including quantities and extra charges must match the PO / purchase value.';
  end if;
end; $$;

commit;
