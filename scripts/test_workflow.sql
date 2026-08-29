-- Exercises the workflow engine against a real Postgres.
-- Run with:  psql ... -v ON_ERROR_STOP=1 -f scripts/test_workflow.sql
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
    if got is distinct from want then
        raise exception 'FAIL % -- got %, want %', label, got, want;
    end if;
    raise notice 'ok   %', label;
end $$;

create or replace function pg_temp.expect_error(label text, sql text, needle text)
returns void language plpgsql as $$
begin
    begin
        execute sql;
        raise exception 'FAIL % -- expected an error, none raised', label;
    exception when others then
        if sqlerrm like '%' || needle || '%' then
            raise notice 'ok   % (%)', label, left(sqlerrm, 60);
        elsif sqlerrm like 'FAIL%' then
            raise;
        else
            raise exception 'FAIL % -- wrong error: %', label, sqlerrm;
        end if;
    end;
end $$;

create or replace function pg_temp.invariant() returns void language plpgsql as $$
declare n integer;
begin
    select count(*) into n from public.pda_balances
     where allocated <> balance + committed + spent;
    if n > 0 then raise exception 'FAIL PDA invariant broken on % row(s)', n; end if;
end $$;

-- ---------------------------------------------------------------- fixtures
insert into public.employees (employee_code, employee_name, email, department, employee_type) values
  ('B24101', 'Aarav Sharma',  'b24101@students.iitmandi.ac.in', 'School of Computing & Electrical Engineering', 'User'),
  ('B24102', 'Ishita Rao',    'b24102@students.iitmandi.ac.in', 'School of Chemical Sciences',                  'User'),
  ('F1201',  'Dr Meera Nair', 'meera@iitmandi.ac.in',           'School of Computing & Electrical Engineering', 'Bill Employee'),
  ('S3001',  'Rakesh Verma',  'rakesh@iitmandi.ac.in',          'Store and Purchase Section',                   'Student Purchase'),
  ('A4001',  'Neha Gupta',    'neha@iitmandi.ac.in',            'Internal Audit',                               'Audit'),
  ('FA5001', 'Sanjay Kaul',   'sanjay@iitmandi.ac.in',          'Finance and Accounts',                         'Finance Admin');

insert into public.pda_balances (employee_id, email, department, allocated, balance) values
  ('B24101', 'b24101@students.iitmandi.ac.in', 'School of Computing & Electrical Engineering', 200000, 200000),
  ('B24102', 'b24102@students.iitmandi.ac.in', 'School of Chemical Sciences',                   80000,  80000);

\set filer  '{"code":"F1201","name":"Dr Meera Nair","role":"Bill Employee"}'
\set apply  'public.fn_submit_bill'

-- ============================================================ 1. routing
do $$
declare b jsonb;
begin
    -- Minor, 40k -> Student Purchase first
    b := public.fn_submit_bill(
        '{"employee_id":"B24101","po_value":40000,"item_category":"Minor","item_description":"Oscilloscope probe set","qty":2,"supplier_name":"Scientific Traders"}'::jsonb,
        '{"code":"F1201","name":"Dr Meera Nair","role":"Bill Employee"}'::jsonb);
    perform pg_temp.check('Minor 40k routes to SNP', b->>'status', 'Student Purchase');
    perform pg_temp.check('Minor 40k bill number issued', (b->>'bill_number') like 'IITM/%', true);

    -- Consumables, 40k -> straight to Finance Admin
    b := public.fn_submit_bill(
        '{"employee_id":"B24101","po_value":40000,"item_category":"Consumables","item_description":"Nitrile gloves, 20 boxes","qty":20}'::jsonb,
        '{"code":"F1201","name":"Dr Meera Nair","role":"Bill Employee"}'::jsonb);
    perform pg_temp.check('Consumables 40k skips SNP', b->>'status', 'Finance Admin');

    -- Consumables, 60k -> Audit
    b := public.fn_submit_bill(
        '{"employee_id":"B24101","po_value":60000,"item_category":"Consumables","item_description":"Reagent bulk order","qty":1}'::jsonb,
        '{"code":"F1201","name":"Dr Meera Nair","role":"Bill Employee"}'::jsonb);
    perform pg_temp.check('Consumables 60k goes to Audit', b->>'status', 'Audit');

    -- Major, 60k -> SNP first
    b := public.fn_submit_bill(
        '{"employee_id":"B24101","po_value":60000,"item_category":"Major","item_description":"Vacuum pump","qty":1}'::jsonb,
        '{"code":"F1201","name":"Dr Meera Nair","role":"Bill Employee"}'::jsonb);
    perform pg_temp.check('Major 60k routes to SNP', b->>'status', 'Student Purchase');
end $$;

-- the 50,000 boundary is inclusive: exactly 50k must NOT go to Audit
do $$ begin
    perform pg_temp.check('50000 exactly -> Finance Admin',
        public.fn_route_after('Student Purchase', 'Minor', 50000), 'Finance Admin');
    perform pg_temp.check('50000.01 -> Audit',
        public.fn_route_after('Student Purchase', 'Minor', 50000.01), 'Audit');
end $$;

-- ============================================================ 2. money reserved, not spent
do $$
declare p public.pda_balances%rowtype;
begin
    select * into p from public.pda_balances where employee_id = 'B24101';
    perform pg_temp.check('4 bills reserved 200k', p.committed, 200000::numeric(12,2));
    perform pg_temp.check('available balance now zero', p.balance, 0::numeric(12,2));
    perform pg_temp.check('nothing spent yet', p.spent, 0::numeric(12,2));
    perform pg_temp.invariant();
end $$;

-- ============================================================ 3. over-spending is refused
select pg_temp.expect_error('overspend refused',
  $q$ select public.fn_submit_bill(
        '{"employee_id":"B24101","po_value":1,"item_category":"Minor","item_description":"paperclip"}'::jsonb,
        '{"code":"F1201","role":"Bill Employee"}'::jsonb) $q$,
  'Insufficient PDA balance');

select pg_temp.expect_error('unknown employee refused',
  $q$ select public.fn_submit_bill(
        '{"employee_id":"NOPE","po_value":100,"item_category":"Minor"}'::jsonb,
        '{"code":"F1201","role":"Bill Employee"}'::jsonb) $q$,
  'No active employee');

select pg_temp.expect_error('zero amount refused',
  $q$ select public.fn_submit_bill(
        '{"employee_id":"B24101","po_value":0,"item_category":"Minor"}'::jsonb,
        '{"code":"F1201","role":"Bill Employee"}'::jsonb) $q$,
  'greater than zero');

-- ============================================================ 4. happy path, end to end
do $$
declare v_id uuid; b jsonb; p public.pda_balances%rowtype; r public.purchase_register%rowtype;
begin
    select id into v_id from public.bills where po_value = 40000 and item_category = 'Minor';

    -- wrong desk cannot touch it
    begin
        perform public.fn_bill_action(v_id, 'A4001', 'Neha Gupta', 'Audit', 'Approved');
        raise exception 'FAIL Audit should not be able to act on an SNP-stage bill';
    exception when others then
        if sqlerrm not like '%is with Student Purchase, not Audit%' then raise; end if;
        raise notice 'ok   wrong desk refused';
    end;

    -- SNP approves, with a bank guarantee
    b := public.fn_bill_action(v_id, 'S3001', 'Rakesh Verma', 'Student Purchase', 'Approved',
         'Verified against the indent.',
         '{"has_bank_guarantee":true,"bank_guarantee_details":"BG/HDFC/2026/881","bank_guarantee_amount":"4000"}'::jsonb);
    perform pg_temp.check('SNP approve -> Finance Admin', b->>'status', 'Finance Admin');
    perform pg_temp.check('SNP stage marked approved',  b->>'snp', 'Approved');
    perform pg_temp.check('finance desk now pending',   b->>'finance_admin', 'Pending');
    perform pg_temp.check('bank guarantee captured',    b->>'bank_guarantee_details', 'BG/HDFC/2026/881');

    -- money still only reserved
    select * into p from public.pda_balances where employee_id = 'B24101';
    perform pg_temp.check('still nothing spent mid-flight', p.spent, 0::numeric(12,2));

    -- Finance Admin approves -> terminal
    b := public.fn_bill_action(v_id, 'FA5001', 'Sanjay Kaul', 'Finance Admin', 'Approved', 'Passed for payment.');
    perform pg_temp.check('final approval -> Accepted', b->>'status', 'Accepted');
    perform pg_temp.check('decided_at stamped', (b->>'decided_at') is not null, true);

    -- money settles
    select * into p from public.pda_balances where employee_id = 'B24101';
    perform pg_temp.check('40k now spent',           p.spent,     40000::numeric(12,2));
    perform pg_temp.check('40k off the commitment',  p.committed, 160000::numeric(12,2));
    perform pg_temp.invariant();

    -- register entry cut
    select * into r from public.purchase_register where bill_id = v_id;
    perform pg_temp.check('register entry created',  r.serial_no like 'SCEE/%', true);
    perform pg_temp.check('register amount matches', r.amount, 40000::numeric(12,2));
    perform pg_temp.check('register names the approver', r.recorded_by, 'FA5001');

    -- the log tells the whole story
    perform pg_temp.check('event log has 6 entries',
        (select count(*)::int from public.bill_approvals where bill_id = v_id), 6);
end $$;

-- ============================================================ 5. rejection refunds
do $$
declare v_id uuid; b jsonb; before numeric; after_ numeric;
begin
    select id into v_id from public.bills where po_value = 60000 and item_category = 'Consumables';
    select balance into before from public.pda_balances where employee_id = 'B24101';

    b := public.fn_bill_action(v_id, 'A4001', 'Neha Gupta', 'Audit', 'Rejected', 'Quotation is not from a GeM vendor.');
    perform pg_temp.check('reject is terminal', b->>'status', 'Rejected');

    select balance into after_ from public.pda_balances where employee_id = 'B24101';
    perform pg_temp.check('rejected money came back', after_ - before, 60000::numeric(12,2));
    perform pg_temp.invariant();

    perform pg_temp.check('no register entry for a rejected bill',
        (select count(*)::int from public.purchase_register where bill_id = v_id), 0);
end $$;

select pg_temp.expect_error('reject needs a remark',
  $q$ select public.fn_bill_action(
        (select id from public.bills where po_value = 60000 and item_category = 'Major'),
        'S3001','Rakesh Verma','Student Purchase','Rejected', '   ') $q$,
  'A remark is required in order to reject');

select pg_temp.expect_error('a decided bill is frozen',
  $q$ select public.fn_bill_action(
        (select id from public.bills where status = 'Rejected' limit 1),
        'FA5001','Sanjay Kaul','Finance Admin','Approved','changed my mind') $q$,
  'already rejected');

-- ============================================================ 6. the ledgers are append-only
select pg_temp.expect_error('cannot edit the event log',
  $q$ update public.bill_approvals set remark = 'tampered' $q$, 'append-only');
select pg_temp.expect_error('cannot delete from the event log',
  $q$ delete from public.bill_approvals $q$, 'append-only');
select pg_temp.expect_error('cannot edit the register',
  $q$ update public.purchase_register set amount = 1 $q$, 'append-only');
select pg_temp.expect_error('cannot delete from the register',
  $q$ delete from public.purchase_register $q$, 'append-only');

-- ============================================================ 7. PDA allocation guard
select pg_temp.expect_error('cannot cut an allocation below what is spent',
  $q$ select public.fn_set_pda_allocation('B24101', 1000) $q$, 'already committed or spent');

do $$
declare p jsonb;
begin
    -- 200k allocated, 40k spent, 60k released on rejection -> 100k still committed.
    -- Raising the allocation to 250k must add the full 50k to the free balance.
    p := public.fn_set_pda_allocation('B24101', 250000, 'PDA1');
    perform pg_temp.check('top-up raises available balance', (p->>'balance')::numeric, 110000::numeric);
    perform pg_temp.check('top-up leaves commitments alone', (p->>'committed')::numeric, 100000::numeric);
    perform pg_temp.check('top-up leaves spend alone',       (p->>'spent')::numeric,      40000::numeric);
    perform pg_temp.invariant();
end $$;

-- ============================================================ 8. numbering
do $$
declare n integer;
begin
    perform pg_temp.check('financial year, August',   public.fn_financial_year('2026-08-29'::timestamptz), '2026-27');
    perform pg_temp.check('financial year, February', public.fn_financial_year('2026-02-14'::timestamptz), '2025-26');
    perform pg_temp.check('financial year, 1 April',  public.fn_financial_year('2026-04-01'::timestamptz), '2026-27');

    select count(distinct bill_number)::int into n from public.bills;
    perform pg_temp.check('every bill number is unique', n, (select count(*)::int from public.bills));
end $$;

\echo ''
\echo '================ ALL WORKFLOW TESTS PASSED ================'
