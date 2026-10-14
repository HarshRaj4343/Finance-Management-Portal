-- =====================================================================
-- 0006_edit_window.sql  --  five-minute correction window
--
-- A freshly filed (or corrected) bill stays with its filer for five
-- minutes. During that window the filer may correct it and no desk may
-- decide it; the API also hides it from the approval queues. After the
-- window the bill is with its desk, and the filer may correct it again
-- only once a desk holds or rejects it.
--
-- Correcting a rejected bill reopens it: the full amount is reserved
-- against the PDA again and the approval route restarts.
--
-- Additive and repeatable. Existing bills keep a null window, so nothing
-- already at a desk disappears from it. No financial records are rewritten.
-- Run after 0005.
-- =====================================================================
begin;
select pg_advisory_xact_lock(hashtext('ifmp:integrity-migration'));

alter table public.bills add column if not exists editable_until timestamptz;

-- >>> Change the window length here only.
create or replace function public.fn_edit_window() returns interval
language sql immutable as $$ select interval '5 minutes' $$;

create or replace function public.fn_edit_window_label() returns text
language sql immutable as $$ select (extract(epoch from public.fn_edit_window()) / 60)::integer || ' minutes' $$;

create or replace function public.fn_bill_open_window() returns trigger language plpgsql as $$
begin
  new.editable_until := now() + public.fn_edit_window();
  return new;
end; $$;
drop trigger if exists bills_edit_window on public.bills;
create trigger bills_edit_window before insert on public.bills
for each row execute function public.fn_bill_open_window();

-- No desk decision may land while the filer can still change the bill.
-- Guarding the row, not just fn_bill_action, covers every write path.
create or replace function public.fn_bill_window_guard() returns trigger language plpgsql as $$
begin
  if old.editable_until > now()
    and coalesce(current_setting('app.bill_amend', true), '') <> 'on'
    and (new.status, new.snp, new.audit, new.finance_admin)
        is distinct from (old.status, old.snp, old.audit, old.finance_admin) then
    raise exception 'This bill is still in its % correction window. It reaches the desk at % IST.',
      replace(public.fn_edit_window_label(), ' minutes', '-minute'), to_char(old.editable_until at time zone 'Asia/Kolkata', 'HH12:MI:SS AM');
  end if;
  return new;
end; $$;
drop trigger if exists bills_window_guard on public.bills;
create trigger bills_window_guard before update on public.bills
for each row execute function public.fn_bill_window_guard();

create or replace function public.fn_amend_bill(p_bill_id uuid, p_payload jsonb, p_actor jsonb)
returns jsonb language plpgsql as $$
declare b public.bills%rowtype; account public.pda_balances%rowtype; amount numeric; delta numeric;
  next_stage text; previous text; in_window boolean; reopening boolean; note text;
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
  perform set_config('app.actor_code', p_actor->>'code', true);
  amount := (p_payload->>'po_value')::numeric;
  -- A rejected bill's money was released; reserve all of it again.
  delta := case when b.pda_committed then amount - b.po_value else amount end;
  select * into account from public.pda_balances where employee_id = b.employee_id and is_active for update;
  if not found then raise exception 'No active PDA account exists.'; end if;
  if account.balance < delta then raise exception 'Insufficient free PDA balance for the correction.'; end if;
  update public.pda_balances set balance = balance - delta, committed = committed + delta, updated_at = now() where id = account.id;
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
      editable_until = now() + public.fn_edit_window()
    where id = b.id returning * into b;
  exception when unique_violation then
    raise exception 'Another active bill already uses this supplier invoice number.';
  end;
  perform set_config('app.bill_amend', '', true);
  note := case
    when reopening then format('Rejected bill corrected and resubmitted. Rs %s reserved against the PDA again.', trim(to_char(amount, 'FM999999990.00')))
    when in_window then 'Corrected by the filer within the edit window.'
    else 'Corrected bill resubmitted.' end
    || ' Previous approvals invalidated; before/after details preserved in change_log.';
  perform public.fn_log_event(b.id, 'Applicant', 'Forwarded', p_actor->>'code', p_actor->>'name', p_actor->>'role',
    note, previous, next_stage, amount);
  return to_jsonb(b);
end; $$;

commit;
