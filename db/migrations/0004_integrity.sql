-- Additive upgrade. Never run 0001_schema.sql over an existing database.
begin;
select pg_advisory_xact_lock(hashtext('ifmp:integrity-migration'));

alter table public.bills add column if not exists revision integer not null default 1;
alter table public.bills add column if not exists created_by text;
alter table public.bills add column if not exists invoice_no text;
alter table public.bills add column if not exists invoice_date date;
alter table public.bills add column if not exists form_data jsonb;
alter table public.bills add column if not exists submission_key uuid;
alter table public.bills add column if not exists submission_hash text;
alter table public.pda_balances add column if not exists is_active boolean not null default true;
update public.bills b set created_by = (
  select actor_code from public.bill_approvals where bill_id = b.id and action = 'Submitted' order by seq limit 1
) where created_by is null and exists(select 1 from public.bill_approvals where bill_id = b.id and action = 'Submitted' and actor_code is not null);

-- Case-insensitive IDs must be unambiguous. Existing collisions require a
-- human decision; the migration fails rather than merging financial records.
create unique index if not exists employees_code_ci on public.employees (upper(employee_code));
create unique index if not exists bills_submission_key on public.bills(created_by, submission_key);

create or replace function public.fn_financial_year(ts timestamptz default now())
returns text language sql immutable as $$
  select case when extract(month from d) >= 4
    then to_char(d, 'YYYY') || '-' || to_char(d + interval '1 year', 'YY')
    else to_char(d - interval '1 year', 'YYYY') || '-' || to_char(d, 'YY') end
  from (select ts at time zone 'Asia/Kolkata' as d) s;
$$;
create unique index if not exists bills_supplier_invoice on public.bills
  (lower(regexp_replace(btrim(supplier_name), '\s+', ' ', 'g')),
   lower(regexp_replace(btrim(invoice_no), '\s+', '', 'g')),
   public.fn_financial_year(invoice_date::timestamp at time zone 'Asia/Kolkata'))
  where invoice_no is not null and status <> 'Rejected';

create or replace function public.fn_next_bill_number(ts timestamptz default now())
returns text language plpgsql as $$
declare fy text := public.fn_financial_year(ts); n text;
begin
  n := public.fn_next_counter('bill:' || fy)::text;
  return 'IITM/' || fy || '/' || lpad(n, greatest(5, length(n)), '0');
end; $$;
create or replace function public.fn_next_register_serial(p_department public.department, ts timestamptz default now())
returns text language plpgsql as $$
declare fy text := public.fn_financial_year(ts); c text; n text;
begin
  select code into c from public.departments where name = p_department;
  c := coalesce(c, 'GEN');
  n := public.fn_next_counter('reg:' || c || ':' || fy)::text;
  return c || '/' || fy || '/' || lpad(n, greatest(4, length(n)), '0');
end; $$;

-- A durable, append-only before/after ledger for financial and administrative changes.
create table if not exists public.change_log (
  id bigint generated always as identity primary key,
  entity text not null, entity_id text not null, operation text not null,
  actor_code text, old_data jsonb, new_data jsonb,
  recorded_at timestamptz not null default now()
);
create index if not exists change_log_entity on public.change_log(entity, entity_id, id);
create or replace function public.fn_change_log() returns trigger language plpgsql as $$
declare old_row jsonb; new_row jsonb;
begin
  if TG_OP <> 'INSERT' then old_row := to_jsonb(old); end if;
  if TG_OP <> 'DELETE' then new_row := to_jsonb(new); end if;
  insert into public.change_log(entity, entity_id, operation, actor_code, old_data, new_data)
  values(TG_TABLE_NAME, coalesce(new_row->>'id', old_row->>'id'), TG_OP,
    nullif(current_setting('app.actor_code', true), ''), old_row, new_row);
  return null;
end; $$;
create or replace function public.fn_immutable_log() returns trigger language plpgsql as $$
begin raise exception 'Audit records are append-only.'; end; $$;
drop trigger if exists change_log_immutable on public.change_log;
create trigger change_log_immutable before update or delete on public.change_log
for each row execute function public.fn_immutable_log();
drop trigger if exists bills_change_log on public.bills;
create trigger bills_change_log after insert or update or delete on public.bills
for each row execute function public.fn_change_log();
drop trigger if exists employees_change_log on public.employees;
create trigger employees_change_log after insert or update or delete on public.employees
for each row execute function public.fn_change_log();
drop trigger if exists pda_change_log on public.pda_balances;
create trigger pda_change_log after insert or update or delete on public.pda_balances
for each row execute function public.fn_change_log();

create or replace function public.fn_employee_guard() returns trigger language plpgsql as $$
declare actor_role text;
begin
  -- Serialise changes that could remove the last active Dean, including
  -- concurrent demotions of two different people.
  perform pg_advisory_xact_lock(hashtext('ifmp:employee-authority'));
  select employee_type into actor_role from public.employees
    where employee_code = nullif(current_setting('app.actor_code', true), '') and is_active;
  if actor_role = 'Finance Admin' then
    if TG_OP = 'DELETE' or (TG_OP = 'INSERT' and new.employee_type <> 'User')
      or (TG_OP = 'UPDATE' and (new.employee_type <> old.employee_type
        or (old.employee_type <> 'User' and (new.is_active <> old.is_active or new.department <> old.department)))) then
      raise exception 'Only the Dean can change privileged access.';
    end if;
  end if;
  if TG_OP <> 'INSERT' and old.employee_type = 'Dean' and old.is_active then
    if TG_OP = 'DELETE' or not new.is_active or new.employee_type <> 'Dean' then
      if not exists(select 1 from public.employees where employee_type = 'Dean' and is_active and id <> old.id) then
        raise exception 'The last active Dean cannot be removed.';
      end if;
    end if;
  end if;
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end; $$;
drop trigger if exists employees_authority_guard on public.employees;
create trigger employees_authority_guard before insert or update or delete on public.employees
for each row execute function public.fn_employee_guard();

create or replace function public.fn_sync_employee_account() returns trigger language plpgsql as $$
begin
  update public.pda_balances set email = new.email, department = new.department, updated_at = now()
    where employee_id = new.employee_code and (email is distinct from new.email or department is distinct from new.department);
  return null;
end; $$;
drop trigger if exists employees_sync_account on public.employees;
create trigger employees_sync_account after update of email, department on public.employees
for each row execute function public.fn_sync_employee_account();

create or replace function public.fn_bill_revision() returns trigger language plpgsql as $$
declare payload jsonb;
begin
  if TG_OP = 'UPDATE' then
    new.revision := old.revision + 1;
    if new.employee_id <> old.employee_id then raise exception 'The applicant cannot change.'; end if;
    new.created_by := old.created_by;
    new.submission_key := old.submission_key;
    new.submission_hash := old.submission_hash;
  else
    payload := nullif(current_setting('app.bill_payload', true), '')::jsonb;
    if payload is not null then
      new.created_by := current_setting('app.actor_code', true);
      new.invoice_no := payload->>'invoice_no';
      new.invoice_date := (payload->>'invoice_date')::date;
      new.form_data := payload->'form_data';
      new.submission_key := (payload->>'submission_key')::uuid;
      new.submission_hash := md5((payload - 'submission_key')::text);
      new.date_of_delivery := (payload->>'date_of_delivery')::date::timestamp at time zone 'Asia/Kolkata';
      new.date_of_installation := (payload->>'date_of_installation')::date::timestamp at time zone 'Asia/Kolkata';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists bills_revision on public.bills;
create trigger bills_revision before insert or update on public.bills
for each row execute function public.fn_bill_revision();

-- Existing legacy rows are retained; new/changed rows cannot contain NaN,
-- infinity or impossible quantities. NOT VALID avoids rewriting history.
do $$ begin
  if not exists(select 1 from pg_constraint where conname = 'pda_finite') then
    alter table public.pda_balances add constraint pda_finite check (
      allocated < 'Infinity'::numeric and balance < 'Infinity'::numeric
      and committed < 'Infinity'::numeric and spent < 'Infinity'::numeric) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname = 'bill_integrity') then
    alter table public.bills add constraint bill_integrity check (
      po_value < 'Infinity'::numeric and (qty is null or qty > 0)
      and (qty_issued is null or (qty_issued >= 0 and qty_issued <= qty))
      and (bank_guarantee_amount is null or (bank_guarantee_amount > 0 and bank_guarantee_amount < 'Infinity'::numeric))) not valid;
  end if;
end $$;

-- Serialise event numbering on the parent bill, including notification events.
create or replace function public.fn_log_event(
 p_bill_id uuid, p_stage text, p_action text, p_actor_code text, p_actor_name text,
 p_actor_role text, p_remark text, p_from_status text, p_to_status text, p_amount numeric default null
) returns void language plpgsql as $$
declare n integer;
begin
  perform 1 from public.bills where id = p_bill_id for update;
  if not found then raise exception 'No such bill.'; end if;
  select coalesce(max(seq), 0) + 1 into n from public.bill_approvals where bill_id = p_bill_id;
  insert into public.bill_approvals(bill_id, seq, stage, action, actor_code, actor_name, actor_role, remark, from_status, to_status, amount)
  values(p_bill_id, n, p_stage, p_action, p_actor_code, p_actor_name, p_actor_role,
    nullif(btrim(coalesce(p_remark, '')), ''), p_from_status, p_to_status, p_amount);
end; $$;

drop function if exists public.fn_assert_bill_writer(text, text, boolean);
create or replace function public.fn_assert_bill_writer(p_code text, p_employee text, p_edit boolean default false, p_department text default null)
returns void language plpgsql as $$
declare a public.employees%rowtype; e public.employees%rowtype;
begin
  select * into a from public.employees where employee_code = p_code and is_active;
  if not found then raise exception 'Your account is inactive.'; end if;
  select * into e from public.employees where employee_code = p_employee;
  if (a.employee_type = 'User' and a.employee_code = e.employee_code) or
    ((a.employee_type = 'Bill Employee' or (p_edit and a.employee_type = 'Bill Editor')) and
     (a.department = 'Store and Purchase Section' or a.department::text = coalesce(p_department, e.department::text))) then return; end if;
  raise exception 'You cannot file or edit bills for this department.';
end; $$;

create or replace function public.fn_validate_bill(p jsonb) returns void language plpgsql as $$
declare total numeric; line jsonb; q integer; issued integer; price numeric;
begin
  if jsonb_typeof(p->'form_data') is distinct from 'object'
    or jsonb_typeof(p->'form_data'->'lines') is distinct from 'array'
    or jsonb_array_length(p->'form_data'->'lines') not between 1 and 100
    or p->'form_data'->>'declaration' is distinct from 'true'
    or p->'form_data'->>'totalConfirmed' is distinct from 'true'
    or p->'form_data'->>'delivered' is distinct from 'yes'
    or coalesce(p->>'item_category','') not in ('Major','Minor','Consumables')
    or coalesce(p->>'source_of_fund','') not in ('OH-31','OH-35')
    or coalesce(btrim(p->>'supplier_name'), '') = ''
    or coalesce(btrim(p->>'supplier_address'), '') = ''
    or coalesce(btrim(p->>'invoice_no'), '') = ''
    or coalesce(btrim(p->>'item_description'), '') = ''
    or coalesce((p->>'qty')::integer, 0) <= 0
    or p->>'qty_issued' is null or (p->>'qty_issued')::integer not between 0 and (p->>'qty')::integer
    or p->>'invoice_date' is null or p->>'date_of_delivery' is null
    or (p->>'invoice_date')::date > (now() at time zone 'Asia/Kolkata')::date
    or (p->>'date_of_delivery')::date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Incomplete or invalid bill details.';
  end if;
  total := coalesce(nullif(regexp_replace(p->'form_data'->>'otherCharges', '[₹,\s]', '', 'g'),'')::numeric, 0);
  if total < 0 or total >= 'Infinity'::numeric then raise exception 'Invalid other charges.'; end if;
  for line in select value from jsonb_array_elements(p->'form_data'->'lines') loop
    q := (line->>'qty')::integer; issued := (line->>'qtyIssued')::integer;
    price := regexp_replace(line->>'unitPrice', '[₹,\s]', '', 'g')::numeric;
    if q is null or issued is null or price is null or q not between 1 and 999 or issued not between 0 and q or price <= 0 or price >= 'Infinity'::numeric then
      raise exception 'Invalid item quantities or price.';
    end if;
    total := total + round(q * price, 2);
  end loop;
  if total <= 0 or total >= 'Infinity'::numeric or total <> (p->>'po_value')::numeric then
    raise exception 'The bill amount must equal the item total and other charges.';
  end if;
end; $$;

-- Keep the proven transactional settlement engine behind validation wrappers.
-- Rename once; rerunning this migration does not wrap a wrapper.
do $$ begin
  if to_regprocedure('public.fn_submit_bill_engine(jsonb,jsonb)') is null then
    alter function public.fn_submit_bill(jsonb,jsonb) rename to fn_submit_bill_engine;
    alter function public.fn_bill_action(uuid,text,text,text,text,text,jsonb) rename to fn_bill_action_engine;
  end if;
end $$;

create or replace function public.fn_submit_bill(p_payload jsonb, p_actor jsonb)
returns jsonb language plpgsql as $$
declare existing public.bills%rowtype; key uuid := (p_payload->>'submission_key')::uuid; result jsonb;
begin
  perform public.fn_assert_bill_writer(p_actor->>'code', p_payload->>'employee_id');
  perform public.fn_validate_bill(p_payload);
  if key is null then raise exception 'A submission key is required.'; end if;
  perform set_config('app.actor_code', p_actor->>'code', true);
  perform pg_advisory_xact_lock(hashtext((p_actor->>'code') || ':' || key::text));
  select * into existing from public.bills where created_by = p_actor->>'code' and submission_key = key;
  if found then
    if existing.submission_hash <> md5((p_payload - 'submission_key')::text) then raise exception 'This submission key was already used for different details.'; end if;
    return to_jsonb(existing);
  end if;
  perform 1 from public.pda_balances where employee_id = p_payload->>'employee_id' and is_active for update;
  if not found then raise exception 'No active PDA account exists.'; end if;
  perform set_config('app.bill_payload', p_payload::text, true);
  result := public.fn_submit_bill_engine(p_payload, p_actor);
  perform set_config('app.bill_payload', '', true);
  return result;
end; $$;

create or replace function public.fn_bill_action(
 p_bill_id uuid, p_actor_code text, p_actor_name text, p_actor_role text,
 p_action text, p_remark text default null, p_extra jsonb default '{}'::jsonb
) returns jsonb language plpgsql as $$
declare b public.bills%rowtype; a public.employees%rowtype; result jsonb; bg numeric;
begin
  select * into b from public.bills where id = p_bill_id for update;
  if not found then raise exception 'No such bill.'; end if;
  select * into a from public.employees where employee_code = p_actor_code and is_active;
  if not found or a.employee_type <> p_actor_role then raise exception 'Your approval access has changed. Sign in again.'; end if;
  if (p_extra->>'expected_revision')::integer is distinct from b.revision then
    raise exception 'The bill has changed. Reload and review the current version.' using errcode = '40001';
  end if;
  if p_actor_code = b.employee_id or p_actor_code = b.created_by then raise exception 'You cannot decide a bill you filed or benefit from.'; end if;
  if p_action = 'Approved' then
    if b.status in ('Audit', 'Finance Admin') and b.item_category <> 'Consumables' and b.snp is distinct from 'Approved' then
      raise exception 'The required Store and Purchase approval is missing. Hold the bill for correction.';
    end if;
    if b.status = 'Finance Admin' and b.po_value > 50000 and b.audit is distinct from 'Approved' then
      raise exception 'The required Audit approval is missing. Hold the bill for correction.';
    end if;
  end if;
  if p_action = 'Approved' and exists(select 1 from public.bill_approvals
    where bill_id = b.id and actor_code = p_actor_code and action = 'Approved'
      and stage <> p_actor_role) then raise exception 'Different approval desks must use different reviewers.'; end if;
  perform set_config('app.actor_code', p_actor_code, true);
  perform 1 from public.pda_balances where employee_id = b.employee_id and is_active for update;
  if not found then raise exception 'The PDA account is missing or closed. Decision cancelled.'; end if;
  if b.status = 'Student Purchase' and p_action = 'Approved' then
    if coalesce((p_extra->>'has_bank_guarantee')::boolean, false) then
      bg := nullif(p_extra->>'bank_guarantee_amount','')::numeric;
      if bg is null or bg <= 0 or bg >= 'Infinity'::numeric or bg <> round(bg, 2) or coalesce(btrim(p_extra->>'bank_guarantee_details'),'') = '' then
        raise exception 'A bank guarantee needs a finite positive amount and details.';
      end if;
    elsif nullif(p_extra->>'bank_guarantee_amount','') is not null or coalesce(btrim(p_extra->>'bank_guarantee_details'),'') <> '' then
      raise exception 'Remove guarantee details when no guarantee applies.';
    end if;
    -- Delivery/installation are validated applicant facts, not optional desk overrides.
    p_extra := p_extra || jsonb_build_object('date_of_delivery', b.date_of_delivery, 'date_of_installation', b.date_of_installation);
  end if;
  result := public.fn_bill_action_engine(p_bill_id, p_actor_code, a.employee_name, a.employee_type, p_action, p_remark, p_extra);
  -- Register date follows the same Indian calendar as its financial year.
  return result;
end; $$;

create or replace function public.fn_amend_bill(p_bill_id uuid, p_payload jsonb, p_actor jsonb)
returns jsonb language plpgsql as $$
declare b public.bills%rowtype; account public.pda_balances%rowtype; amount numeric; delta numeric; next_stage text; previous text;
begin
  select * into b from public.bills where id = p_bill_id for update;
  if not found then raise exception 'No such bill.'; end if;
  perform public.fn_assert_bill_writer(p_actor->>'code', b.employee_id, true, b.employee_department::text);
  if (p_payload->>'expected_revision')::integer is distinct from b.revision then
    raise exception 'The bill has changed. Reload before correcting it.' using errcode = '40001';
  end if;
  if b.status in ('Accepted', 'Rejected') or not (
    (b.status = 'Student Purchase' and b.snp = 'Hold') or
    (b.status = 'Audit' and b.audit = 'Hold') or
    (b.status = 'Finance Admin' and b.finance_admin = 'Hold')) then
    raise exception 'Only a bill currently on hold can be corrected.';
  end if;
  if p_payload->>'employee_id' is distinct from b.employee_id then raise exception 'The applicant cannot change.'; end if;
  perform public.fn_validate_bill(p_payload);
  perform set_config('app.actor_code', p_actor->>'code', true);
  amount := (p_payload->>'po_value')::numeric; delta := amount - b.po_value;
  select * into account from public.pda_balances where employee_id = b.employee_id and is_active for update;
  if not found then raise exception 'No active PDA account exists.'; end if;
  if account.balance < delta then raise exception 'Insufficient free PDA balance for the correction.'; end if;
  update public.pda_balances set balance = balance - delta, committed = committed + delta, updated_at = now() where id = account.id;
  previous := b.status;
  next_stage := public.fn_route_after('Submit', p_payload->>'item_category', amount);
  update public.bills set po_value = amount, po_details = p_payload->>'po_details',
    supplier_name = p_payload->>'supplier_name', supplier_address = p_payload->>'supplier_address',
    item_description = p_payload->>'item_description', item_category = p_payload->>'item_category',
    qty = (p_payload->>'qty')::integer, qty_issued = (p_payload->>'qty_issued')::integer,
    bill_details = p_payload->>'bill_details', source_of_fund = p_payload->>'source_of_fund', location = p_payload->>'location',
    invoice_no = p_payload->>'invoice_no', invoice_date = (p_payload->>'invoice_date')::date, form_data = p_payload->'form_data',
    date_of_delivery = (p_payload->>'date_of_delivery')::date::timestamp at time zone 'Asia/Kolkata',
    date_of_installation = (p_payload->>'date_of_installation')::date::timestamp at time zone 'Asia/Kolkata',
    has_bank_guarantee = false, bank_guarantee_amount = null, bank_guarantee_details = null,
    status = next_stage, snp = case when next_stage = 'Student Purchase' then 'Pending' end,
    audit = case when next_stage = 'Audit' then 'Pending' end,
    finance_admin = case when next_stage = 'Finance Admin' then 'Pending' end,
    remarks = null, remarks1 = null, remarks2 = null
  where id = b.id returning * into b;
  perform public.fn_log_event(b.id, 'Applicant', 'Forwarded', p_actor->>'code', p_actor->>'name', p_actor->>'role',
    'Corrected bill resubmitted. Previous approvals invalidated; before/after details preserved in change_log.', previous, next_stage, amount);
  return to_jsonb(b);
end; $$;

create or replace function public.fn_note_bill(p_bill_id uuid, p_actor jsonb)
returns jsonb language plpgsql as $$
declare b public.bills%rowtype;
begin
  select * into b from public.bills where id = p_bill_id for update;
  if not found then raise exception 'No such bill.'; end if;
  perform public.fn_assert_bill_writer(p_actor->>'code', b.employee_id, true, b.employee_department::text);
  if b.status <> 'Rejected' then raise exception 'Only rejected bills can be acknowledged.'; end if;
  if b.noted then return to_jsonb(b); end if;
  perform set_config('app.actor_code', p_actor->>'code', true);
  update public.bills set noted = true where id = b.id returning * into b;
  perform public.fn_log_event(b.id, 'Applicant', 'Forwarded', p_actor->>'code', p_actor->>'name', p_actor->>'role',
    'Rejection acknowledged.', 'Rejected', 'Rejected', null);
  return to_jsonb(b);
end; $$;

create or replace function public.fn_set_pda_allocation(
 p_employee_code text, p_allocated numeric, p_actor_code text default null
) returns jsonb language plpgsql as $$
declare a public.pda_balances%rowtype;
begin
  if not exists(select 1 from public.employees where employee_code = p_actor_code and is_active and employee_type in ('Dean','PDA Manager')) then
    raise exception 'Only the PDA Manager or Dean may change allocations.';
  end if;
  select * into a from public.pda_balances where employee_id = p_employee_code and is_active for update;
  if not found then raise exception 'No active PDA account exists.'; end if;
  if p_allocated is null or p_allocated < a.committed + a.spent or p_allocated >= 'Infinity'::numeric or p_allocated <> round(p_allocated, 2) then
    raise exception 'Allocation must be finite and cover committed and spent money.';
  end if;
  perform set_config('app.actor_code', p_actor_code, true);
  update public.pda_balances set allocated = p_allocated, balance = p_allocated - committed - spent, updated_at = now()
    where id = a.id returning * into a;
  return to_jsonb(a);
end; $$;
create or replace function public.fn_top_up_pda(p_code text, p_amount numeric, p_actor text)
returns jsonb language plpgsql as $$
declare a public.pda_balances%rowtype;
begin
  if p_amount is null or p_amount <= 0 or p_amount >= 'Infinity'::numeric or p_amount <> round(p_amount, 2) then raise exception 'Top-up must be a finite positive amount with at most two decimal places.'; end if;
  select * into a from public.pda_balances where employee_id = p_code and is_active for update;
  if not found then raise exception 'No active PDA account exists.'; end if;
  return public.fn_set_pda_allocation(p_code, a.allocated + p_amount, p_actor);
end; $$;
create or replace function public.fn_close_pda(p_code text, p_actor text)
returns void language plpgsql as $$
declare a public.pda_balances%rowtype;
begin
  if not exists(select 1 from public.employees where employee_code = p_actor and is_active and employee_type in ('Dean','PDA Manager')) then raise exception 'PDA management access is required.'; end if;
  select * into a from public.pda_balances where employee_id = p_code for update;
  if not found then raise exception 'No PDA account exists.'; end if;
  if a.committed <> 0 or a.spent <> 0 or exists(select 1 from public.bills where employee_id = p_code and status not in ('Accepted','Rejected')) then
    raise exception 'An account with committed or spent funds cannot be closed.';
  end if;
  perform set_config('app.actor_code', p_actor, true);
  update public.pda_balances set is_active = false, updated_at = now() where id = a.id;
end; $$;

create or replace function public.fn_register_date() returns trigger language plpgsql as $$
begin new.entry_date := (now() at time zone 'Asia/Kolkata')::date; return new; end; $$;
drop trigger if exists register_indian_date on public.purchase_register;
create trigger register_indian_date before insert on public.purchase_register
for each row execute function public.fn_register_date();
-- Internal settlement engines are not entry points for other database roles.
revoke execute on function public.fn_submit_bill_engine(jsonb,jsonb) from public;
revoke execute on function public.fn_bill_action_engine(uuid,text,text,text,text,text,jsonb) from public;
commit;
