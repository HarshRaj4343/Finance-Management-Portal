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
