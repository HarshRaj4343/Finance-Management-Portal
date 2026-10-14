-- =====================================================================
-- 0007_fund_heads.sql  --  OH-31 / OH-35 become real budget heads
--
-- Until now every bill reserved and spent the applicant's PDA, whatever
-- source of fund was chosen; OH-31 and OH-35 were only labels. They are
-- institute budget heads allocated each financial year (MoE "Support to
-- IITs": OH-31 general / recurring, OH-35 creation of capital assets), and
-- PDA is a personal professional-development allowance. They are now
-- separate pools:
--
--   PDA    -> the applicant's PDA account (unchanged)
--   OH-31  -> the institute OH-31 head for the bill's financial year
--   OH-35  -> the institute OH-35 head for the bill's financial year
--
-- Each head keeps the same invariant as a PDA account:
--     allocated = balance + committed + spent
-- and an append-only ledger (allocations sanctioned by the Dean, and every
-- reservation, release and spend by a bill) -- the head-wise register of
-- grants and expenditure (GFR 2017 forms GFR 5 / GFR 21).
--
-- bills.funding_pool records which pool actually holds a bill's money, so
-- release and settlement always return to the same place. Existing bills
-- keep a null pool and are treated as PDA, because that is where their
-- money was reserved. No historical balance or bill is rewritten.
--
-- Fund rule (hard): Consumables -> OH-31 or PDA; Major -> OH-35 or PDA;
-- Minor -> any.
--
-- Additive and repeatable. Run after 0006; repeat upgrades must end here.
-- =====================================================================
begin;
select pg_advisory_xact_lock(hashtext('ifmp:integrity-migration'));

create table if not exists public.fund_heads (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code in ('OH-31', 'OH-35')),
  financial_year text not null check (financial_year ~ '^\d{4}-\d{2}$'),
  allocated numeric(14,2) not null default 0,
  balance numeric(14,2) not null default 0,
  committed numeric(14,2) not null default 0,
  spent numeric(14,2) not null default 0,
  updated_at timestamptz not null default now(),
  unique (code, financial_year),
  constraint fund_head_non_negative check (allocated >= 0 and balance >= 0 and committed >= 0 and spent >= 0),
  constraint fund_head_conserved check (allocated = balance + committed + spent)
);

create table if not exists public.fund_head_entries (
  id bigint generated always as identity primary key,
  fund_head_id uuid not null references public.fund_heads(id),
  code text not null,
  financial_year text not null,
  kind text not null check (kind in ('Allocation', 'Reserved', 'Released', 'Spent')),
  amount numeric(14,2) not null,
  reference text,
  entry_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  remarks text,
  bill_id uuid references public.bills(id),
  actor_code text,
  recorded_at timestamptz not null default now()
);
create index if not exists fund_head_entries_head on public.fund_head_entries(fund_head_id, id);
create index if not exists fund_head_entries_bill on public.fund_head_entries(bill_id);

drop trigger if exists fund_head_entries_immutable on public.fund_head_entries;
create trigger fund_head_entries_immutable before update or delete on public.fund_head_entries
for each row execute function public.fn_immutable_log();
drop trigger if exists fund_heads_change_log on public.fund_heads;
create trigger fund_heads_change_log after insert or update or delete on public.fund_heads
for each row execute function public.fn_change_log();

alter table public.bills add column if not exists funding_pool text;
alter table public.bills add column if not exists funding_fy text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bills_funding_pool_check') then
    alter table public.bills add constraint bills_funding_pool_check
      check (funding_pool is null or funding_pool in ('PDA', 'OH-31', 'OH-35'));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Pools
-- ---------------------------------------------------------------------
create or replace function public.fn_pool_for(p_fund text) returns text
language sql immutable as $$
  select case when p_fund in ('OH-31', 'OH-35') then p_fund else 'PDA' end
$$;

-- Lock the pool a bill draws on, refusing a closed PDA or an unfunded head.
create or replace function public.fn_pool_lock(p_pool text, p_fy text, p_employee text)
returns void language plpgsql as $$
begin
  if p_pool = 'PDA' then
    perform 1 from public.pda_balances where employee_id = p_employee and is_active for update;
    if not found then raise exception 'No active PDA account exists.'; end if;
  else
    perform 1 from public.fund_heads where code = p_pool and financial_year = p_fy for update;
    if not found then
      raise exception 'No % budget has been allocated for %. Ask the Dean''s office.', p_pool, p_fy;
    end if;
  end if;
end; $$;

-- The only place money moves for a bill.
--   Reserved: balance -> committed  (a negative amount gives money back)
--   Released: committed -> balance
--   Spent:    committed -> spent
create or replace function public.fn_pool_move(
  p_pool text, p_fy text, p_employee text, p_kind text, p_amount numeric, p_bill uuid, p_actor text
) returns void language plpgsql as $$
declare h public.fund_heads%rowtype; a public.pda_balances%rowtype;
begin
  if p_amount is null or p_amount = 0 then return; end if;
  if p_kind not in ('Reserved', 'Released', 'Spent') then raise exception 'Unknown fund movement %.', p_kind; end if;
  if p_pool = 'PDA' then
    select * into a from public.pda_balances where employee_id = p_employee for update;
    if not found then raise exception 'No PDA account exists for "%".', p_employee; end if;
    if p_kind = 'Reserved' and a.balance < p_amount then
      raise exception 'Insufficient PDA balance. Available Rs %, bill needs Rs %.',
        trim(to_char(a.balance, 'FM999999999990.00')), trim(to_char(p_amount, 'FM999999999990.00'));
    end if;
    update public.pda_balances set
      balance   = balance   - case when p_kind = 'Reserved' then p_amount when p_kind = 'Released' then -p_amount else 0 end,
      committed = committed + case when p_kind = 'Reserved' then p_amount else -p_amount end,
      spent     = spent     + case when p_kind = 'Spent' then p_amount else 0 end,
      updated_at = now()
    where id = a.id;
    return;
  end if;
  select * into h from public.fund_heads where code = p_pool and financial_year = p_fy for update;
  if not found then raise exception 'No % budget has been allocated for %. Ask the Dean''s office.', p_pool, p_fy; end if;
  if p_kind = 'Reserved' and h.balance < p_amount then
    raise exception 'Insufficient % budget for %. Available Rs %, bill needs Rs %.', p_pool, p_fy,
      trim(to_char(h.balance, 'FM999999999990.00')), trim(to_char(p_amount, 'FM999999999990.00'));
  end if;
  update public.fund_heads set
    balance   = balance   - case when p_kind = 'Reserved' then p_amount when p_kind = 'Released' then -p_amount else 0 end,
    committed = committed + case when p_kind = 'Reserved' then p_amount else -p_amount end,
    spent     = spent     + case when p_kind = 'Spent' then p_amount else 0 end,
    updated_at = now()
  where id = h.id;
  insert into public.fund_head_entries(fund_head_id, code, financial_year, kind, amount, bill_id, actor_code)
  values (h.id, h.code, h.financial_year, p_kind, p_amount, p_bill, p_actor);
end; $$;

-- The Dean sanctions money to a head. Additions only; the ledger is permanent.
create or replace function public.fn_add_fund_allocation(
  p_code text, p_fy text, p_amount numeric, p_reference text, p_date date, p_remarks text, p_actor text
) returns jsonb language plpgsql as $$
declare h public.fund_heads%rowtype;
begin
  if not exists (select 1 from public.employees where employee_code = p_actor and is_active and employee_type = 'Dean') then
    raise exception 'Only the Dean can allocate OH-31 or OH-35 funds.';
  end if;
  if p_code not in ('OH-31', 'OH-35') then raise exception 'Choose OH-31 or OH-35.'; end if;
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

-- Hard rule tying the source of fund to the item category.
create or replace function public.fn_validate_fund(p jsonb) returns void language plpgsql as $$
begin
  if p->>'item_category' = 'Consumables' and p->>'source_of_fund' = 'OH-35' then
    raise exception 'OH-35 is for creation of capital assets. Charge consumables to OH-31 or the PDA.';
  end if;
  if p->>'item_category' = 'Major' and p->>'source_of_fund' = 'OH-31' then
    raise exception 'OH-31 is the general (recurring) head. Charge major equipment to OH-35 or the PDA.';
  end if;
end; $$;

-- ---------------------------------------------------------------------
-- Submission: the engine, and the wrapper that guards it
-- ---------------------------------------------------------------------
create or replace function public.fn_submit_bill_engine(p_payload jsonb, p_actor jsonb)
returns jsonb language plpgsql as $fn$
declare
    v_emp_code  text    := btrim(p_payload->>'employee_id');
    v_amount    numeric := (p_payload->>'po_value')::numeric;
    v_category  text    := p_payload->>'item_category';
    v_pool      text    := public.fn_pool_for(p_payload->>'source_of_fund');
    v_fy        text;
    v_emp       public.employees%rowtype;
    v_status    text;
    v_number    text;
    v_bill      public.bills%rowtype;
    v_where     text;
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
    select * into v_emp from public.employees where employee_code = v_emp_code and is_active;
    if not found then
        raise exception 'No active employee with ID "%". Ask the Dean''s office to add them first.', v_emp_code
            using errcode = 'P0001';
    end if;

    v_fy := case when v_pool = 'PDA' then null else public.fn_financial_year() end;
    -- Lock first: two bills filed together cannot both pass the balance check.
    perform public.fn_pool_lock(v_pool, v_fy, v_emp_code);

    v_status := public.fn_route_after('Submit', v_category, v_amount);
    v_number := public.fn_next_bill_number();

    insert into public.bills (
        bill_number, employee_id, employee_name, employee_department,
        po_details, po_value, supplier_name, supplier_address,
        item_category, item_description, qty, qty_issued, bill_details,
        indenter_name, source_of_fund, stock_entry, location,
        status, snp, audit, finance_admin, pda_committed, funding_pool, funding_fy
    ) values (
        v_number, v_emp_code,
        coalesce(nullif(btrim(p_payload->>'employee_name'), ''), v_emp.employee_name),
        v_emp.department,
        nullif(btrim(p_payload->>'po_details'), ''), v_amount,
        nullif(btrim(p_payload->>'supplier_name'), ''), nullif(btrim(p_payload->>'supplier_address'), ''),
        v_category, nullif(btrim(p_payload->>'item_description'), ''),
        nullif(p_payload->>'qty', '')::integer, nullif(p_payload->>'qty_issued', '')::integer,
        nullif(btrim(p_payload->>'bill_details'), ''), nullif(btrim(p_payload->>'indenter_name'), ''),
        nullif(btrim(p_payload->>'source_of_fund'), ''), nullif(btrim(p_payload->>'stock_entry'), ''),
        nullif(btrim(p_payload->>'location'), ''),
        v_status,
        case when v_status = 'Student Purchase' then 'Pending' end,
        case when v_status = 'Audit'            then 'Pending' end,
        case when v_status = 'Finance Admin'    then 'Pending' end,
        true, v_pool, v_fy
    ) returning * into v_bill;

    -- Reserve, do not spend; a rejection puts it straight back.
    perform public.fn_pool_move(v_pool, v_fy, v_emp_code, 'Reserved', v_amount, v_bill.id, p_actor->>'code');

    v_where := case when v_pool = 'PDA' then format('the PDA of %s', v_emp_code)
                    else format('the %s budget for %s', v_pool, v_fy) end;
    perform public.fn_log_event(v_bill.id, 'Applicant', 'Submitted',
        p_actor->>'code', p_actor->>'name', p_actor->>'role',
        format('Bill %s filed for %s. Rs %s reserved against %s.', v_number,
               coalesce(v_bill.item_description, 'purchase'), trim(to_char(v_amount, 'FM999999990.00')), v_where),
        null, v_status, v_amount);
    perform public.fn_log_event(v_bill.id, 'System', 'Forwarded', null, null, null,
        format('Routed to %s (%s, Rs %s).', v_status, v_category, trim(to_char(v_amount, 'FM999999990.00'))),
        null, v_status, v_amount);
    return to_jsonb(v_bill);
end;
$fn$;

create or replace function public.fn_submit_bill(p_payload jsonb, p_actor jsonb)
returns jsonb language plpgsql as $$
declare existing public.bills%rowtype; key uuid := (p_payload->>'submission_key')::uuid; result jsonb;
begin
  perform public.fn_assert_bill_writer(p_actor->>'code', p_payload->>'employee_id');
  perform public.fn_validate_bill(p_payload);
  perform public.fn_validate_fund(p_payload);
  if key is null then raise exception 'A submission key is required.'; end if;
  perform set_config('app.actor_code', p_actor->>'code', true);
  perform pg_advisory_xact_lock(hashtext((p_actor->>'code') || ':' || key::text));
  select * into existing from public.bills where created_by = p_actor->>'code' and submission_key = key;
  if found then
    if existing.submission_hash <> md5((p_payload - 'submission_key')::text) then raise exception 'This submission key was already used for different details.'; end if;
    return to_jsonb(existing);
  end if;
  perform set_config('app.bill_payload', p_payload::text, true);
  result := public.fn_submit_bill_engine(p_payload, p_actor);
  perform set_config('app.bill_payload', '', true);
  return result;
end; $$;

-- ---------------------------------------------------------------------
-- Decisions: the engine moves the bill's own pool, never "the PDA"
-- ---------------------------------------------------------------------
create or replace function public.fn_bill_action_engine(
    p_bill_id uuid, p_actor_code text, p_actor_name text, p_actor_role text,
    p_action text, p_remark text default null, p_extra jsonb default '{}'::jsonb
) returns jsonb language plpgsql as $fn$
declare
    v_bill    public.bills%rowtype;
    v_stage   text;
    v_next    text;
    v_serial  text;
    v_remark  text := nullif(btrim(coalesce(p_remark, '')), '');
    v_stamped text;
    v_was_committed boolean;
    v_pool    text;
    v_where   text;
begin
    if p_action not in ('Approved', 'Rejected', 'Hold') then
        raise exception 'Unknown action "%".', p_action using errcode = 'P0001';
    end if;
    select * into v_bill from public.bills where id = p_bill_id for update;
    if not found then raise exception 'No such bill.' using errcode = 'P0001'; end if;
    if v_bill.status in ('Accepted', 'Rejected') then
        raise exception 'This bill is already % and cannot be changed.', lower(v_bill.status) using errcode = 'P0001';
    end if;
    v_stage := v_bill.status;
    if v_stage <> p_actor_role then
        raise exception 'This bill is with %, not %.', v_stage, p_actor_role using errcode = 'P0001';
    end if;
    if p_action in ('Rejected', 'Hold') and v_remark is null then
        raise exception 'A remark is required in order to % this bill.',
            case p_action when 'Rejected' then 'reject' else 'hold' end using errcode = 'P0001';
    end if;
    v_pool := coalesce(v_bill.funding_pool, 'PDA');
    v_where := case when v_pool = 'PDA' then format('the PDA of %s', v_bill.employee_id)
                    else format('the %s budget for %s', v_pool, v_bill.funding_fy) end;
    v_stamped := case when v_remark is null then null else
        format('%s (By: %s at %s)', v_remark, coalesce(p_actor_name, p_actor_code, p_actor_role),
               to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')) end;

    if p_action = 'Hold' then
        update public.bills set
            snp           = case when v_stage = 'Student Purchase' then 'Hold' else snp           end,
            audit         = case when v_stage = 'Audit'            then 'Hold' else audit         end,
            finance_admin = case when v_stage = 'Finance Admin'    then 'Hold' else finance_admin end,
            remarks1      = case when v_stage = 'Student Purchase' then v_stamped else remarks1 end,
            remarks2      = case when v_stage = 'Audit'            then v_stamped else remarks2 end,
            remarks       = case when v_stage = 'Finance Admin'    then v_stamped else remarks  end
        where id = p_bill_id returning * into v_bill;
        perform public.fn_log_event(p_bill_id, v_stage, 'Hold', p_actor_code, p_actor_name, p_actor_role,
            v_remark, v_stage, v_stage, v_bill.po_value);
        return to_jsonb(v_bill);
    end if;

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
            perform public.fn_pool_move(v_pool, v_bill.funding_fy, v_bill.employee_id, 'Released', v_bill.po_value, v_bill.id, p_actor_code);
        end if;
        perform public.fn_log_event(p_bill_id, v_stage, 'Rejected', p_actor_code, p_actor_name, p_actor_role,
            v_remark, v_stage, 'Rejected', v_bill.po_value);
        perform public.fn_log_event(p_bill_id, 'System', 'Forwarded', null, null, null,
            format('Rs %s released back to %s.', trim(to_char(v_bill.po_value, 'FM999999990.00')), v_where),
            'Rejected', 'Rejected', v_bill.po_value);
        return to_jsonb(v_bill);
    end if;

    if v_stage = 'Finance Admin' then
        update public.bills set
            status        = 'Accepted',
            finance_admin = 'Approved',
            decided_at    = now(),
            remarks       = coalesce(v_stamped, remarks),
            pda_committed = false,
            pda_settled   = true
        where id = p_bill_id returning * into v_bill;
        perform public.fn_pool_move(v_pool, v_bill.funding_fy, v_bill.employee_id, 'Spent', v_bill.po_value, v_bill.id, p_actor_code);
        v_serial := public.fn_next_register_serial(v_bill.employee_department);
        insert into public.purchase_register (
            serial_no, financial_year, bill_id, bill_number, entry_date,
            department, employee_code, employee_name, indenter_name,
            item_description, item_category, qty, supplier_name,
            supplier_address, amount, source_of_fund, stock_entry, location, recorded_by
        ) values (
            v_serial, public.fn_financial_year(), v_bill.id, v_bill.bill_number, current_date,
            v_bill.employee_department, v_bill.employee_id, v_bill.employee_name,
            v_bill.indenter_name, v_bill.item_description, v_bill.item_category,
            v_bill.qty, v_bill.supplier_name, v_bill.supplier_address,
            v_bill.po_value, v_bill.source_of_fund, v_bill.stock_entry, v_bill.location, p_actor_code
        );
        perform public.fn_log_event(p_bill_id, 'Finance Admin', 'Approved', p_actor_code, p_actor_name, p_actor_role,
            v_remark, v_stage, 'Accepted', v_bill.po_value);
        perform public.fn_log_event(p_bill_id, 'System', 'Registered', null, null, null,
            format('Entered in the %s register as %s. Rs %s debited from %s.', v_bill.employee_department, v_serial,
                   trim(to_char(v_bill.po_value, 'FM999999990.00')), v_where),
            'Accepted', 'Accepted', v_bill.po_value);
        return to_jsonb(v_bill);
    end if;

    v_next := public.fn_route_after(v_stage, v_bill.item_category, v_bill.po_value);
    update public.bills set
        status        = v_next,
        snp           = case when v_stage = 'Student Purchase' then 'Approved' else snp end,
        remarks1      = case when v_stage = 'Student Purchase' then coalesce(v_stamped, remarks1) else remarks1 end,
        remarks2      = case when v_stage = 'Audit'            then coalesce(v_stamped, remarks2) else remarks2 end,
        audit         = case when v_stage = 'Audit' then 'Approved' when v_next = 'Audit' then 'Pending' else audit end,
        finance_admin = case when v_next = 'Finance Admin' then 'Pending' else finance_admin end,
        has_bank_guarantee     = case when v_stage = 'Student Purchase' then coalesce((p_extra->>'has_bank_guarantee')::boolean, false) else has_bank_guarantee end,
        bank_guarantee_details = case when v_stage = 'Student Purchase' then nullif(btrim(coalesce(p_extra->>'bank_guarantee_details','')), '') else bank_guarantee_details end,
        bank_guarantee_amount  = case when v_stage = 'Student Purchase' then nullif(p_extra->>'bank_guarantee_amount','')::numeric else bank_guarantee_amount end,
        date_of_installation   = case when v_stage = 'Student Purchase' then nullif(p_extra->>'date_of_installation','')::timestamptz else date_of_installation end,
        date_of_delivery       = case when v_stage = 'Student Purchase' then nullif(p_extra->>'date_of_delivery','')::timestamptz else date_of_delivery end
    where id = p_bill_id returning * into v_bill;
    perform public.fn_log_event(p_bill_id, v_stage, 'Approved', p_actor_code, p_actor_name, p_actor_role,
        v_remark, v_stage, v_next, v_bill.po_value);
    perform public.fn_log_event(p_bill_id, 'System', 'Forwarded', null, null, null,
        format('Forwarded to %s.', v_next), v_stage, v_next, v_bill.po_value);
    return to_jsonb(v_bill);
end;
$fn$;

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
  begin
    perform public.fn_pool_lock(coalesce(b.funding_pool, 'PDA'), b.funding_fy, b.employee_id);
  exception when raise_exception then
    raise exception 'The bill''s funding account is missing or closed. Decision cancelled.';
  end;
  if b.status = 'Student Purchase' and p_action = 'Approved' then
    if coalesce((p_extra->>'has_bank_guarantee')::boolean, false) then
      bg := nullif(p_extra->>'bank_guarantee_amount','')::numeric;
      if bg is null or bg <= 0 or bg >= 'Infinity'::numeric or bg <> round(bg, 2) or coalesce(btrim(p_extra->>'bank_guarantee_details'),'') = '' then
        raise exception 'A bank guarantee needs a finite positive amount and details.';
      end if;
    elsif nullif(p_extra->>'bank_guarantee_amount','') is not null or coalesce(btrim(p_extra->>'bank_guarantee_details'),'') <> '' then
      raise exception 'Remove guarantee details when no guarantee applies.';
    end if;
    p_extra := p_extra || jsonb_build_object('date_of_delivery', b.date_of_delivery, 'date_of_installation', b.date_of_installation);
  end if;
  result := public.fn_bill_action_engine(p_bill_id, p_actor_code, a.employee_name, a.employee_type, p_action, p_remark, p_extra);
  return result;
end; $$;

-- ---------------------------------------------------------------------
-- Corrections move the reservation between pools when the fund changes
-- ---------------------------------------------------------------------
create or replace function public.fn_amend_bill(p_bill_id uuid, p_payload jsonb, p_actor jsonb)
returns jsonb language plpgsql as $$
declare b public.bills%rowtype; amount numeric; next_stage text; previous text; in_window boolean; reopening boolean; note text;
  old_pool text; new_pool text; new_fy text;
begin
  select * into b from public.bills where id = p_bill_id for update;
  if not found then raise exception 'No such bill.'; end if;
  perform public.fn_assert_bill_writer(p_actor->>'code', b.employee_id, true, b.employee_department::text);
  if (p_payload->>'expected_revision')::integer is distinct from b.revision then
    raise exception 'The bill has changed. Reload before correcting it.' using errcode = '40001';
  end if;
  in_window := b.editable_until > now() and b.status not in ('Accepted', 'Rejected');
  reopening := b.status = 'Rejected';
  if b.status = 'Accepted' or not (in_window or reopening or
    (b.status = 'Student Purchase' and b.snp = 'Hold') or
    (b.status = 'Audit' and b.audit = 'Hold') or
    (b.status = 'Finance Admin' and b.finance_admin = 'Hold')) then
    raise exception 'A bill can be corrected only within % of filing, or after a desk holds or rejects it.', public.fn_edit_window_label();
  end if;
  if p_payload->>'employee_id' is distinct from b.employee_id then raise exception 'The applicant cannot change.'; end if;
  perform public.fn_validate_bill(p_payload);
  perform public.fn_validate_fund(p_payload);
  perform set_config('app.actor_code', p_actor->>'code', true);
  amount := (p_payload->>'po_value')::numeric;
  old_pool := coalesce(b.funding_pool, 'PDA');
  new_pool := public.fn_pool_for(p_payload->>'source_of_fund');
  -- An OH bill keeps charging the financial year it was filed in.
  new_fy := case when new_pool = 'PDA' then null
                 when new_pool = old_pool and b.funding_fy is not null then b.funding_fy
                 else public.fn_financial_year(b.created_at) end;
  perform public.fn_pool_lock(new_pool, new_fy, b.employee_id);
  if b.pda_committed then
    if new_pool = old_pool and new_fy is not distinct from b.funding_fy then
      perform public.fn_pool_move(new_pool, new_fy, b.employee_id, 'Reserved', amount - b.po_value, b.id, p_actor->>'code');
    else
      perform public.fn_pool_move(old_pool, b.funding_fy, b.employee_id, 'Released', b.po_value, b.id, p_actor->>'code');
      perform public.fn_pool_move(new_pool, new_fy, b.employee_id, 'Reserved', amount, b.id, p_actor->>'code');
    end if;
  else
    -- A rejected bill's money was released; reserve all of it again.
    perform public.fn_pool_move(new_pool, new_fy, b.employee_id, 'Reserved', amount, b.id, p_actor->>'code');
  end if;
  previous := b.status;
  next_stage := public.fn_route_after('Submit', p_payload->>'item_category', amount);
  perform set_config('app.bill_amend', 'on', true);
  begin
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
      remarks = null, remarks1 = null, remarks2 = null,
      pda_committed = true, decided_at = null, noted = false,
      funding_pool = new_pool, funding_fy = new_fy,
      editable_until = now() + public.fn_edit_window()
    where id = b.id returning * into b;
  exception when unique_violation then
    raise exception 'Another active bill already uses this supplier invoice number.';
  end;
  perform set_config('app.bill_amend', '', true);
  note := case
    when reopening then format('Rejected bill corrected and resubmitted. Rs %s reserved again.', trim(to_char(amount, 'FM999999990.00')))
    when in_window then 'Corrected by the filer within the edit window.'
    else 'Corrected bill resubmitted.' end
    || case when new_pool <> old_pool then format(' Funding moved from %s to %s.', old_pool, new_pool) else '' end
    || ' Previous approvals invalidated; before/after details preserved in change_log.';
  perform public.fn_log_event(b.id, 'Applicant', 'Forwarded', p_actor->>'code', p_actor->>'name', p_actor->>'role',
    note, previous, next_stage, amount);
  return to_jsonb(b);
end; $$;

-- Only PDA-funded bills in flight keep a PDA account open.
create or replace function public.fn_close_pda(p_code text, p_actor text)
returns void language plpgsql as $$
declare a public.pda_balances%rowtype;
begin
  if not exists(select 1 from public.employees where employee_code = p_actor and is_active and employee_type in ('Dean','PDA Manager')) then raise exception 'PDA management access is required.'; end if;
  select * into a from public.pda_balances where employee_id = p_code for update;
  if not found then raise exception 'No PDA account exists.'; end if;
  if a.committed <> 0 or a.spent <> 0 or exists(select 1 from public.bills where employee_id = p_code
      and coalesce(funding_pool, 'PDA') = 'PDA' and status not in ('Accepted','Rejected')) then
    raise exception 'An account with committed or spent funds cannot be closed.';
  end if;
  perform set_config('app.actor_code', p_actor, true);
  update public.pda_balances set is_active = false, updated_at = now() where id = a.id;
end; $$;

revoke execute on function public.fn_pool_move(text, text, text, text, numeric, uuid, text) from public;
revoke execute on function public.fn_submit_bill_engine(jsonb, jsonb) from public;
revoke execute on function public.fn_bill_action_engine(uuid, text, text, text, text, text, jsonb) from public;
commit;
