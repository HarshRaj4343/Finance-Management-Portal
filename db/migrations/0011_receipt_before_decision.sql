-- =====================================================================
-- 0011_receipt_before_decision.sql  --  a desk decides only a received bill
--
-- Every bill reaching a desk gets an inward register entry (0008), which
-- the desk ticks Received when the paper file arrives (0009). A desk may
-- now Approve, Hold, Reject or send back a bill only once the inward entry
-- for its current arrival at that desk is marked Received. Bills without
-- any inward entry at the desk are not held up.
--
-- Same fn_bill_action as 0010, plus that check. No data is changed:
-- bills already pending stay Not received until the desk ticks them.
-- Additive and repeatable. Run after 0010.
-- =====================================================================
begin;
select pg_advisory_xact_lock(hashtext('ifmp:integrity-migration'));

create or replace function public.fn_bill_action(
 p_bill_id uuid, p_actor_code text, p_actor_name text, p_actor_role text,
 p_action text, p_remark text default null, p_extra jsonb default '{}'::jsonb
) returns jsonb language plpgsql as $$
declare b public.bills%rowtype; a public.employees%rowtype; m public.bill_movements%rowtype; result jsonb; bg numeric;
begin
  select * into b from public.bills where id = p_bill_id for update;
  if not found then raise exception 'No such bill.'; end if;
  select * into a from public.employees where employee_code = p_actor_code and is_active;
  if not found or a.employee_type <> p_actor_role then raise exception 'Your approval access has changed. Sign in again.'; end if;
  if (p_extra->>'expected_revision')::integer is distinct from b.revision then
    raise exception 'The bill has changed. Reload and review the current version.' using errcode = '40001';
  end if;
  if p_actor_code = b.employee_id or p_actor_code = b.created_by then raise exception 'You cannot decide a bill you filed or benefit from.'; end if;
  -- The paper file must have reached the desk: its inward entry is marked Received.
  if b.status = p_actor_role then
    select * into m from public.bill_movements
     where bill_id = b.id and desk = b.status and register = 'Inward' order by id desc limit 1;
    if found and not m.received then
      raise exception 'Mark this bill Received in the inward register (%) before deciding it.', m.serial_no;
    end if;
  end if;
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

commit;
