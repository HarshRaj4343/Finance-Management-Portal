-- =====================================================================
-- 0008_movement_registers.sql  --  inward and outward registers
--
-- The office practice of a diary (inward) register and a dispatch
-- (outward) register, kept per desk, for every bill:
--
--   Inward   a bill arrives at a desk: from the filer (new, corrected or
--            resubmitted) or from the previous desk.
--   Outward  a bill leaves a desk: forwarded to the next desk, closed into
--            the purchase register, returned to the filer on hold or
--            rejection, or recalled by the filer inside the edit window.
--
-- Entries are derived from the append-only workflow log (bill_approvals)
-- the moment each event is written, so the registers can never disagree
-- with what actually happened. Each entry gets a permanent serial per
-- desk, register and financial year, e.g. SNP/IN/2026-27/00001.
--
-- Existing history is replayed once into the registers, oldest first.
-- Additive and repeatable. Run after 0007.
-- =====================================================================
begin;
select pg_advisory_xact_lock(hashtext('ifmp:integrity-migration'));

create table if not exists public.bill_movements (
  id bigint generated always as identity primary key,
  register text not null check (register in ('Inward', 'Outward')),
  desk text not null check (desk in ('Student Purchase', 'Audit', 'Finance Admin')),
  financial_year text not null,
  serial_no text not null unique,
  event_id uuid not null references public.bill_approvals(id),
  bill_id uuid not null references public.bills(id),
  bill_number text,
  employee_id text,
  employee_name text,
  department text,
  item_description text,
  amount numeric(12,2),
  counterpart text not null,     -- where it came from (inward) or is going (outward)
  nature text not null,          -- New bill, Forwarded, Correction, On hold, Rejected, ...
  actor_code text,
  actor_name text,
  actor_role text,
  remark text,
  moved_at timestamptz not null, -- received (inward) or dispatched (outward)
  recorded_at timestamptz not null default now(),
  unique (event_id, register, desk)
);
create index if not exists bill_movements_desk on public.bill_movements(desk, register, financial_year, id desc);
create index if not exists bill_movements_bill on public.bill_movements(bill_id, id);

drop trigger if exists bill_movements_immutable on public.bill_movements;
create trigger bill_movements_immutable before update or delete on public.bill_movements
for each row execute function public.fn_immutable_log();

create or replace function public.fn_desk_code(p_desk text) returns text
language sql immutable as $$
  select case p_desk when 'Student Purchase' then 'SNP' when 'Audit' then 'AUD' when 'Finance Admin' then 'FA' end
$$;

create or replace function public.fn_desk_name(p_status text) returns text
language sql immutable as $$
  select case p_status
    when 'Student Purchase' then 'Store and Purchase Department'
    when 'Accepted' then 'Closed: entered in the purchase register'
    else p_status end
$$;

-- One numbered entry. Idempotent per (event, register, desk).
create or replace function public.fn_record_movement(
  p_register text, p_desk text, e public.bill_approvals, b public.bills,
  p_counterpart text, p_nature text, p_moved_at timestamptz
) returns void language plpgsql as $$
declare fy text := public.fn_financial_year(p_moved_at); n integer;
begin
  if exists (select 1 from public.bill_movements where event_id = e.id and register = p_register and desk = p_desk) then return; end if;
  n := public.fn_next_counter(format('mov:%s:%s:%s', case p_register when 'Inward' then 'IN' else 'OUT' end, public.fn_desk_code(p_desk), fy));
  insert into public.bill_movements(register, desk, financial_year, serial_no, event_id, bill_id, bill_number,
    employee_id, employee_name, department, item_description, amount, counterpart, nature,
    actor_code, actor_name, actor_role, remark, moved_at)
  values (p_register, p_desk, fy,
    format('%s/%s/%s/%s', public.fn_desk_code(p_desk), case p_register when 'Inward' then 'IN' else 'OUT' end, fy, lpad(n::text, greatest(5, length(n::text)), '0')),
    e.id, b.id, b.bill_number, b.employee_id, b.employee_name, b.employee_department::text, b.item_description,
    coalesce(e.amount, b.po_value), p_counterpart, p_nature, e.actor_code, e.actor_name, e.actor_role,
    -- A filing's remark is the system reservation note; keep only people's remarks.
    case when p_nature = 'New bill' then null else e.remark end, p_moved_at);
end; $$;

-- Map one workflow event to its register entries.
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
  -- A new or corrected bill reaches its desk only when the filer's edit
  -- window closes (0006). Bills from before the window arrived at once.
  arrives := e.created_at + case when b.editable_until is not null then public.fn_edit_window() else interval '0' end;

  -- Filed.
  if e.stage = 'Applicant' and e.action = 'Submitted' and e.to_status = any(desks) then
    perform public.fn_record_movement('Inward', e.to_status, e, b, filer, 'New bill', arrives);
    return;
  end if;

  -- Corrected or resubmitted by the filer.
  if e.stage = 'Applicant' and e.action = 'Forwarded' and e.to_status = any(desks) and e.from_status is not null then
    if e.from_status = any(desks) then
      -- Still undispatched at that desk: the filer pulled it back inside the edit window.
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
  elsif e.action = 'Hold' then
    perform public.fn_record_movement('Outward', e.stage, e, b, filer || ' (returned for correction)', 'On hold', e.created_at);
  elsif e.action = 'Rejected' then
    perform public.fn_record_movement('Outward', e.stage, e, b, 'Filer (returned)', 'Rejected', e.created_at);
  end if;
end; $$;

create or replace function public.fn_bill_movement_trigger() returns trigger language plpgsql as $$
begin
  perform public.fn_movements_for_event(new);
  return null;
end; $$;

-- Replay existing history once, oldest first, before live recording starts.
do $$
declare e public.bill_approvals%rowtype;
begin
  if not exists (select 1 from public.bill_movements) then
    for e in select * from public.bill_approvals order by created_at, bill_id, seq loop
      perform public.fn_movements_for_event(e);
    end loop;
  end if;
end $$;

drop trigger if exists bill_approvals_movements on public.bill_approvals;
create trigger bill_approvals_movements after insert on public.bill_approvals
for each row execute function public.fn_bill_movement_trigger();

commit;
