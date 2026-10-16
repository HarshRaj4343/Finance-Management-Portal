-- =====================================================================
-- 0010_send_back.sql  --  send a bill back to an earlier desk
--
-- When a desk refuses a bill it may now choose where the bill goes:
--
--   Reject permanently       as before: closed, its money released.
--   Send back to the filer   as before: Hold.
--   Send back to a desk      new: action 'Returned'. The bill goes to an
--                            earlier desk on its route that has already
--                            approved it (Finance Admin -> Audit or Store
--                            and Purchase; Audit -> Store and Purchase).
--
-- A sent-back bill keeps its money reserved in the same pool. At the
-- receiving desk it is Pending again; approvals from the receiving desk
-- onwards are cleared, so it walks the normal route forward again and
-- every later desk reviews it afresh. The sending desk's column reads
-- 'Returned' until the bill comes back to it. The remark is optional.
--
-- The receiving desk may correct the whole bill, money included, through
-- fn_desk_amend_bill, and then decide it like any other (the corrector
-- may approve their own correction; later desks review it again). A
-- correction that would need an earlier desk the bill has not passed --
-- e.g. a consumable turned into equipment at Audit -- is refused: hold it
-- for the filer instead.
--
-- Both actions are written to the workflow log and, through it, to the
-- inward / outward registers. Additive and repeatable. Run after 0009.
-- =====================================================================
begin;
select pg_advisory_xact_lock(hashtext('ifmp:integrity-migration'));

-- Who sent the bill back, why and when. Cleared once the receiving desk decides it.
alter table public.bills add column if not exists returned_from text;
alter table public.bills add column if not exists returned_remark text;
alter table public.bills add column if not exists returned_at timestamptz;

alter table public.bills drop constraint if exists bills_snp_check;
alter table public.bills add constraint bills_snp_check
  check (snp is null or snp in ('Pending','Hold','Reject','Approved','Returned'));
alter table public.bills drop constraint if exists bills_audit_check;
alter table public.bills add constraint bills_audit_check
  check (audit is null or audit in ('Pending','Hold','Reject','Approved','Returned'));
alter table public.bills drop constraint if exists bills_finance_admin_check;
alter table public.bills add constraint bills_finance_admin_check
  check (finance_admin is null or finance_admin in ('Pending','Hold','Reject','Approved','Returned'));

alter table public.bill_approvals drop constraint if exists approvals_action_check;
alter table public.bill_approvals add constraint approvals_action_check check (
  action in ('Submitted','Approved','Rejected','Hold','Forwarded','Registered','Notified','Returned','Corrected'));

-- Position of a desk on the route; null for anything else.
create or replace function public.fn_desk_order(p_desk text) returns integer
language sql immutable as $$
  select case p_desk when 'Student Purchase' then 1 when 'Audit' then 2 when 'Finance Admin' then 3 end
$$;

-- The send-back marker lasts until the receiving desk decides the bill,
-- or the filer corrects it: any change of desk or desk state ends it.
create or replace function public.fn_bill_clear_return() returns trigger language plpgsql as $$
begin
  if new.returned_from is not null and coalesce(current_setting('app.bill_return', true), '') <> 'on'
    and (new.status, new.snp, new.audit, new.finance_admin)
        is distinct from (old.status, old.snp, old.audit, old.finance_admin) then
    new.returned_from := null; new.returned_remark := null; new.returned_at := null;
  end if;
  return new;
end; $$;
drop trigger if exists bills_clear_return on public.bills;
create trigger bills_clear_return before update on public.bills
for each row execute function public.fn_bill_clear_return();

-- ---------------------------------------------------------------------
-- The send-back itself. Called by fn_bill_action after its checks.
-- ---------------------------------------------------------------------
create or replace function public.fn_bill_return_engine(
  p_bill_id uuid, p_actor_code text, p_actor_name text, p_actor_role text,
  p_remark text, p_to text
) returns jsonb language plpgsql as $$
declare b public.bills%rowtype; v_stage text; v_from integer; v_to integer;
  v_remark text := nullif(btrim(coalesce(p_remark, '')), ''); col_state text;
begin
  select * into b from public.bills where id = p_bill_id for update;
  v_stage := b.status;
  v_from := public.fn_desk_order(v_stage);
  v_to := public.fn_desk_order(p_to);
  if v_from is null then raise exception 'This bill is not at an approval desk.' using errcode = 'P0001'; end if;
  if v_to is null or v_to >= v_from then
    raise exception 'A bill can be sent back only to an earlier desk on its route.' using errcode = 'P0001';
  end if;
  col_state := case p_to when 'Student Purchase' then b.snp when 'Audit' then b.audit end;
  if col_state is distinct from 'Approved' then
    raise exception '% has not approved this bill, so it cannot be sent back there.', public.fn_desk_name(p_to) using errcode = 'P0001';
  end if;
  perform set_config('app.bill_return', 'on', true);
  -- Earlier desks keep their approval; the receiving desk reviews it again;
  -- desks between are cleared; the sender waits for it as 'Returned'.
  -- The reason lives in returned_remark and the workflow log, not in the
  -- desk remark columns, so it does not linger once the bill moves on.
  update public.bills set
    status        = p_to,
    snp           = case when v_to = 1 then 'Pending' else snp end,
    audit         = case when v_to = 2 then 'Pending' when v_from = 2 then 'Returned' when v_to < 2 then null else audit end,
    finance_admin = case when v_from = 3 then 'Returned' else null end,
    remarks1      = case when v_to = 1 then null else remarks1 end,
    remarks2      = case when v_to <= 2 and v_from = 3 then null else remarks2 end,
    returned_from = v_stage, returned_remark = v_remark, returned_at = now()
  where id = p_bill_id returning * into b;
  perform set_config('app.bill_return', '', true);

  perform public.fn_log_event(p_bill_id, v_stage, 'Returned', p_actor_code, p_actor_name, p_actor_role,
    v_remark, v_stage, p_to, b.po_value);
  return to_jsonb(b);
end; $$;

-- Same as 0007, plus the 'Returned' action.
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
  if p_action = 'Returned' then
    if b.status in ('Accepted', 'Rejected') then
      raise exception 'This bill is already % and cannot be changed.', lower(b.status);
    end if;
    if b.status <> p_actor_role then raise exception 'This bill is with %, not %.', b.status, p_actor_role; end if;
    perform set_config('app.actor_code', p_actor_code, true);
    return public.fn_bill_return_engine(p_bill_id, p_actor_code, a.employee_name, a.employee_type, p_remark, p_extra->>'return_to');
  end if;
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
-- A correction by the desk a bill was sent back to. The bill stays at
-- that desk; its money follows the corrected amount and fund, as in
-- fn_amend_bill. Earlier desks' approvals stand.
-- ---------------------------------------------------------------------
create or replace function public.fn_desk_amend_bill(p_bill_id uuid, p_payload jsonb, p_actor jsonb)
returns jsonb language plpgsql as $$
declare b public.bills%rowtype; a public.employees%rowtype; amount numeric; desk_at integer;
  old_pool text; new_pool text; new_fy text; at text := 'Submit'; stop text; note text;
begin
  select * into b from public.bills where id = p_bill_id for update;
  if not found then raise exception 'No such bill.'; end if;
  select * into a from public.employees where employee_code = p_actor->>'code' and is_active;
  if not found or a.employee_type is distinct from b.status then
    raise exception 'Only the desk this bill is with can correct it.';
  end if;
  if b.returned_from is null then
    raise exception 'A desk can correct a bill only after it has been sent back to that desk.';
  end if;
  if a.employee_code = b.employee_id or a.employee_code = b.created_by then
    raise exception 'You cannot correct a bill you filed or benefit from.';
  end if;
  if (p_payload->>'expected_revision')::integer is distinct from b.revision then
    raise exception 'The bill has changed. Reload before correcting it.' using errcode = '40001';
  end if;
  if p_payload->>'employee_id' is distinct from b.employee_id then raise exception 'The applicant cannot change.'; end if;
  perform public.fn_validate_bill(p_payload);
  perform public.fn_validate_fund(p_payload);
  amount := (p_payload->>'po_value')::numeric;

  -- Every desk the corrected bill must pass before this one has to have approved it.
  desk_at := public.fn_desk_order(b.status);
  loop
    stop := public.fn_route_after(at, p_payload->>'item_category', amount);
    exit when public.fn_desk_order(stop) >= desk_at;
    if (case stop when 'Student Purchase' then b.snp when 'Audit' then b.audit end) is distinct from 'Approved' then
      raise exception 'This correction means the bill must first pass %, which has not approved it. Hold the bill for the filer to correct instead.',
        public.fn_desk_name(stop);
    end if;
    exit when stop = 'Finance Admin';
    at := stop;
  end loop;

  perform set_config('app.actor_code', a.employee_code, true);
  old_pool := coalesce(b.funding_pool, 'PDA');
  new_pool := public.fn_pool_for(p_payload->>'source_of_fund');
  new_fy := case when new_pool = 'PDA' then null
                 when new_pool = old_pool and b.funding_fy is not null then b.funding_fy
                 else public.fn_financial_year(b.created_at) end;
  perform public.fn_pool_lock(new_pool, new_fy, b.employee_id);
  if new_pool = old_pool and new_fy is not distinct from b.funding_fy then
    perform public.fn_pool_move(new_pool, new_fy, b.employee_id, 'Reserved', amount - b.po_value, b.id, a.employee_code);
  else
    perform public.fn_pool_move(old_pool, b.funding_fy, b.employee_id, 'Released', b.po_value, b.id, a.employee_code);
    perform public.fn_pool_move(new_pool, new_fy, b.employee_id, 'Reserved', amount, b.id, a.employee_code);
  end if;
  note := format('Corrected by %s after %s sent it back.', public.fn_desk_name(b.status), public.fn_desk_name(b.returned_from))
    || case when amount <> b.po_value then format(' Amount changed from Rs %s to Rs %s.',
         trim(to_char(b.po_value, 'FM999999990.00')), trim(to_char(amount, 'FM999999990.00'))) else '' end
    || case when new_pool <> old_pool then format(' Funding moved from %s to %s.', old_pool, new_pool) else '' end
    || ' Before/after details preserved in change_log.';
  begin
    update public.bills set po_value = amount, po_details = p_payload->>'po_details',
      supplier_name = p_payload->>'supplier_name', supplier_address = p_payload->>'supplier_address',
      item_description = p_payload->>'item_description', item_category = p_payload->>'item_category',
      qty = (p_payload->>'qty')::integer, qty_issued = (p_payload->>'qty_issued')::integer,
      bill_details = p_payload->>'bill_details', source_of_fund = p_payload->>'source_of_fund', location = p_payload->>'location',
      invoice_no = p_payload->>'invoice_no', invoice_date = (p_payload->>'invoice_date')::date, form_data = p_payload->'form_data',
      date_of_delivery = (p_payload->>'date_of_delivery')::date::timestamp at time zone 'Asia/Kolkata',
      date_of_installation = (p_payload->>'date_of_installation')::date::timestamp at time zone 'Asia/Kolkata',
      funding_pool = new_pool, funding_fy = new_fy
    where id = b.id returning * into b;
  exception when unique_violation then
    raise exception 'Another active bill already uses this supplier invoice number.';
  end;
  perform public.fn_log_event(b.id, b.status, 'Corrected', a.employee_code, a.employee_name, a.employee_type,
    note, b.status, b.status, amount);
  return to_jsonb(b);
end; $$;

-- ---------------------------------------------------------------------
-- Inward / outward registers: same as 0008, plus send-backs.
-- ---------------------------------------------------------------------
create or replace function public.fn_movements_for_event(e public.bill_approvals) returns void language plpgsql as $$
declare
  b public.bills%rowtype;
  desks constant text[] := array['Student Purchase', 'Audit', 'Finance Admin'];
  filer text;
  last_mov public.bill_movements%rowtype;
  arrives timestamptz;
begin
  select * into b from public.bills where id = e.bill_id;
  if not found then return; end if;
  filer := format('Filer: %s', coalesce(e.actor_name, e.actor_code, 'applicant'));
  arrives := e.created_at + case when b.editable_until is not null then public.fn_edit_window() else interval '0' end;

  if e.stage = 'Applicant' and e.action = 'Submitted' and e.to_status = any(desks) then
    perform public.fn_record_movement('Inward', e.to_status, e, b, filer, 'New bill', arrives);
    return;
  end if;

  if e.stage = 'Applicant' and e.action = 'Forwarded' and e.to_status = any(desks) and e.from_status is not null then
    if e.from_status = any(desks) then
      select * into last_mov from public.bill_movements where bill_id = b.id order by id desc limit 1;
      if found and last_mov.register = 'Inward' and last_mov.desk = e.from_status then
        perform public.fn_record_movement('Outward', e.from_status, e, b, filer, 'Recalled by filer for correction', e.created_at);
      end if;
    end if;
    perform public.fn_record_movement('Inward', e.to_status, e, b, filer,
      case when e.from_status = 'Rejected' then 'Resubmitted after rejection' else 'Correction' end, arrives);
    return;
  end if;

  if not (e.stage = any(desks)) then return; end if;

  if e.action = 'Approved' then
    perform public.fn_record_movement('Outward', e.stage, e, b, public.fn_desk_name(e.to_status),
      case when e.to_status = 'Accepted' then 'Final approval' else 'Approved and forwarded' end, e.created_at);
    if e.to_status = any(desks) then
      perform public.fn_record_movement('Inward', e.to_status, e, b, public.fn_desk_name(e.stage), 'Forwarded', e.created_at);
    end if;
  elsif e.action = 'Returned' and e.to_status = any(desks) then
    perform public.fn_record_movement('Outward', e.stage, e, b, public.fn_desk_name(e.to_status), 'Sent back', e.created_at);
    perform public.fn_record_movement('Inward', e.to_status, e, b, public.fn_desk_name(e.stage), 'Sent back for correction', e.created_at);
  elsif e.action = 'Hold' then
    perform public.fn_record_movement('Outward', e.stage, e, b, filer || ' (returned for correction)', 'On hold', e.created_at);
  elsif e.action = 'Rejected' then
    perform public.fn_record_movement('Outward', e.stage, e, b, 'Filer (returned)', 'Rejected', e.created_at);
  end if;
end; $$;

revoke execute on function public.fn_bill_return_engine(uuid, text, text, text, text, text) from public;
commit;
