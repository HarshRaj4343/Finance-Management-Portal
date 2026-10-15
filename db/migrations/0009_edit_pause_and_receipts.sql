-- =====================================================================
-- 0009_edit_pause_and_receipts.sql
--
-- 1. The edit window (0006) pauses while the filer has the bill open in
--    the correction form, and resumes when the form closes.
--
--    While paused the bill records the time left on the clock
--    (edit_paused_seconds) and a short lease (edit_paused_until). The
--    open form renews the lease every minute. editable_until is held at
--    lease end + time left, so every existing check -- the desks' queue,
--    fn_bill_window_guard and fn_amend_bill -- keeps working unchanged.
--    If the form vanishes without resuming (tab closed, network lost),
--    the clock simply restarts when the lease runs out.
--
--    A bill may be paused for at most 30 minutes in all, across every
--    pause and every correction (fn_edit_pause_limit). The time used is
--    kept in edit_pause_used_seconds; once it is spent, the clock runs
--    even with the form open.
--
--    Pausing changes only timing, never content, so it does not bump the
--    bill's revision: the open form's expected_revision stays valid.
--
-- 2. The inward register shows when a paused bill actually reached its
--    desk (bill_movement_arrivals), not when it was first expected.
--
-- 3. Each inward / outward entry can be marked Received or Not received
--    by its own desk or the Dean. The mark is kept on the register row
--    itself (bill_movements.received, received_by, received_by_name,
--    received_at). Those four columns are the only ones that may ever
--    change, and only through fn_mark_movement_received; every change is
--    kept in change_log.
--
-- Additive and repeatable. Run after 0008.
-- =====================================================================
begin;
select pg_advisory_xact_lock(hashtext('ifmp:integrity-migration'));

alter table public.bills add column if not exists edit_paused_until timestamptz;
alter table public.bills add column if not exists edit_paused_seconds integer;
alter table public.bills add column if not exists edit_paused_since timestamptz;
alter table public.bills add column if not exists edit_pause_used_seconds integer not null default 0;

-- >>> The pause lease. The correction form renews it every minute.
create or replace function public.fn_edit_pause_lease() returns interval
language sql immutable as $$ select interval '3 minutes' $$;

-- >>> The most a bill may be paused in all.
create or replace function public.fn_edit_pause_limit() returns interval
language sql immutable as $$ select interval '30 minutes' $$;

-- Seconds of pause the current (or lapsed) pause has used, up to now.
create or replace function public.fn_edit_pause_spent(b public.bills) returns integer
language sql stable as $$
  select case when b.edit_paused_since is null then 0
    else greatest(0, ceil(extract(epoch from least(now(), b.edit_paused_until) - b.edit_paused_since)))::integer end
$$;

-- Same as 0004, except that a change to window timing alone is not a new
-- revision of the bill.
create or replace function public.fn_bill_revision() returns trigger language plpgsql as $$
declare payload jsonb;
  timing constant text[] := array['editable_until', 'edit_paused_until', 'edit_paused_seconds', 'edit_paused_since',
    'edit_pause_used_seconds', 'updated_at', 'revision'];
begin
  if TG_OP = 'UPDATE' then
    if (to_jsonb(new) - timing) = (to_jsonb(old) - timing) then return new; end if;
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

-- A saved correction opens a fresh window (fn_amend_bill); any pause on
-- the old one ends with it. The pause time used still counts.
create or replace function public.fn_bill_clear_edit_pause() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.bill_amend', true), '') = 'on' then
    new.edit_pause_used_seconds := old.edit_pause_used_seconds + public.fn_edit_pause_spent(old);
    new.edit_paused_since := null;
    new.edit_paused_until := null;
    new.edit_paused_seconds := null;
  end if;
  return new;
end; $$;
drop trigger if exists bills_clear_edit_pause on public.bills;
create trigger bills_clear_edit_pause before update on public.bills
for each row execute function public.fn_bill_clear_edit_pause();

-- When a filer-sent inward entry actually reaches its desk, if a pause
-- moved it. Derived from bills.editable_until, whose changes change_log keeps.
create table if not exists public.bill_movement_arrivals (
  movement_id bigint primary key references public.bill_movements(id),
  arrives_at timestamptz not null
);

create or replace function public.fn_sync_window_arrival(b public.bills) returns void language plpgsql as $$
declare last_mov public.bill_movements%rowtype;
begin
  select * into last_mov from public.bill_movements where bill_id = b.id order by id desc limit 1;
  if not found or last_mov.register <> 'Inward'
    or last_mov.nature not in ('New bill', 'Correction', 'Resubmitted after rejection') then return; end if;
  insert into public.bill_movement_arrivals(movement_id, arrives_at) values (last_mov.id, b.editable_until)
  on conflict (movement_id) do update set arrives_at = excluded.arrives_at;
end; $$;

-- p_pause true: stop the clock (or renew the lease). false: restart it.
-- A bill with no running window (held, rejected, decided) is returned as is.
-- No lease reaches past the bill's remaining pause allowance.
create or replace function public.fn_edit_window_pause(p_bill_id uuid, p_actor text, p_pause boolean)
returns jsonb language plpgsql as $$
declare b public.bills%rowtype; left_s integer; used_s integer; since timestamptz; allowance interval;
begin
  select * into b from public.bills where id = p_bill_id for update;
  if not found then raise exception 'No such bill.' using errcode = 'P0001'; end if;
  perform public.fn_assert_bill_writer(p_actor, b.employee_id, true, b.employee_department::text);
  if b.status in ('Accepted', 'Rejected') or b.editable_until is null or b.editable_until <= now() then
    return to_jsonb(b);
  end if;
  -- Time left on the clock now: frozen while a lease holds, else running.
  left_s := case when b.edit_paused_until > now() then b.edit_paused_seconds
                 else ceil(extract(epoch from b.editable_until - now()))::integer end;
  if not p_pause and b.edit_paused_since is null then return to_jsonb(b); end if;
  perform set_config('app.actor_code', p_actor, true);
  -- A pause still holding continues; a lapsed one is closed and counted.
  if b.edit_paused_until > now() then
    since := b.edit_paused_since; used_s := b.edit_pause_used_seconds;
  else
    since := null; used_s := b.edit_pause_used_seconds + public.fn_edit_pause_spent(b);
  end if;
  allowance := public.fn_edit_pause_limit() - make_interval(secs => used_s) - (now() - coalesce(since, now()));
  if p_pause and allowance > interval '0' then
    update public.bills set edit_paused_seconds = left_s, edit_pause_used_seconds = used_s,
        edit_paused_since = coalesce(since, now()),
        edit_paused_until = now() + least(public.fn_edit_pause_lease(), allowance),
        editable_until = now() + least(public.fn_edit_pause_lease(), allowance) + make_interval(secs => left_s)
      where id = b.id returning * into b;
  else
    -- Resume, or the allowance is spent: the clock runs from here.
    update public.bills set edit_paused_seconds = null, edit_paused_until = null, edit_paused_since = null,
        edit_pause_used_seconds = least(used_s + case when since is null then 0
          else ceil(extract(epoch from now() - since))::integer end,
          extract(epoch from public.fn_edit_pause_limit())::integer),
        editable_until = now() + make_interval(secs => left_s)
      where id = b.id returning * into b;
  end if;
  perform public.fn_sync_window_arrival(b);
  return to_jsonb(b);
end; $$;

-- Received / Not received marks, on the register row itself.
alter table public.bill_movements add column if not exists received boolean not null default false;
alter table public.bill_movements add column if not exists received_by text;
alter table public.bill_movements add column if not exists received_by_name text;
alter table public.bill_movements add column if not exists received_at timestamptz;

-- Register entries stay append-only, except for their receipt mark,
-- which only fn_mark_movement_received may set.
create or replace function public.fn_bill_movement_guard() returns trigger language plpgsql as $$
declare receipt constant text[] := array['received', 'received_by', 'received_by_name', 'received_at'];
begin
  if TG_OP = 'DELETE' or coalesce(current_setting('app.movement_receipt', true), '') <> 'on'
    or (to_jsonb(new) - receipt) <> (to_jsonb(old) - receipt) then
    raise exception 'Audit records are append-only.';
  end if;
  return new;
end; $$;
drop trigger if exists bill_movements_immutable on public.bill_movements;
create trigger bill_movements_immutable before update or delete on public.bill_movements
for each row execute function public.fn_bill_movement_guard();

-- Marks saved by an earlier build of this migration in a side table move
-- onto the register rows, and the side table goes.
drop view if exists public.bill_movement_entries;
do $$
begin
  if to_regclass('public.bill_movement_receipts') is not null then
    perform set_config('app.movement_receipt', 'on', true);
    update public.bill_movements m set received = r.received, received_by = r.marked_by,
        received_by_name = r.marked_by_name, received_at = r.marked_at
      from public.bill_movement_receipts r where r.movement_id = m.id;
    perform set_config('app.movement_receipt', '', true);
    drop table public.bill_movement_receipts;
  end if;
end $$;

drop trigger if exists bill_movements_change_log on public.bill_movements;
create trigger bill_movements_change_log after update on public.bill_movements
for each row execute function public.fn_change_log();

create or replace function public.fn_mark_movement_received(p_movement_id bigint, p_received boolean, p_actor text)
returns jsonb language plpgsql as $$
declare a public.employees%rowtype; m public.bill_movements%rowtype;
begin
  select * into a from public.employees where employee_code = p_actor and is_active;
  if not found then raise exception 'Your account is inactive.' using errcode = 'P0001'; end if;
  select * into m from public.bill_movements where id = p_movement_id for update;
  if not found then raise exception 'No such register entry.' using errcode = 'P0001'; end if;
  if a.employee_type not in ('Dean', m.desk) then
    raise exception 'Only % or the Dean can mark this entry.', public.fn_desk_name(m.desk) using errcode = 'P0001';
  end if;
  perform set_config('app.actor_code', p_actor, true);
  perform set_config('app.movement_receipt', 'on', true);
  update public.bill_movements set received = p_received, received_by = a.employee_code,
      received_by_name = a.employee_name, received_at = now()
    where id = m.id returning * into m;
  perform set_config('app.movement_receipt', '', true);
  return jsonb_build_object('movement_id', m.id, 'received', m.received, 'received_by', m.received_by,
    'received_by_name', m.received_by_name, 'received_at', m.received_at);
end; $$;

-- The registers as read: actual arrival time and the current receipt mark.
create view public.bill_movement_entries as
select m.id, m.register, m.desk, m.financial_year, m.serial_no, m.event_id, m.bill_id, m.bill_number,
       m.employee_id, m.employee_name, m.department, m.item_description, m.amount,
       m.counterpart, m.nature, m.actor_code, m.actor_name, m.actor_role, m.remark,
       coalesce(a.arrives_at, m.moved_at) as moved_at, m.recorded_at,
       m.received, m.received_by_name as received_by, m.received_at as received_marked_at
  from public.bill_movements m
  left join public.bill_movement_arrivals a on a.movement_id = m.id;

commit;
