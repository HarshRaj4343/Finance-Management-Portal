-- =====================================================================
-- 0003_demo_data.sql  --  realistic IIT Mandi demo dataset
--
-- Bills are not inserted directly. Every one is filed through
-- fn_submit_bill and pushed along with fn_bill_action, so the PDA
-- balances, the event log and the purchase register are all genuine
-- consequences of the workflow rather than invented rows.
--
-- Timestamps are back-dated afterwards to spread the data over the last
-- six months. That is the one place the append-only triggers are lifted,
-- and only for the duration of this script.
--
-- Safe to re-run: it clears the transactional tables first.
-- =====================================================================

begin;

-- ---------------------------------------------------------------- reset
alter table public.bill_approvals    disable trigger bill_approvals_append_only;
alter table public.purchase_register disable trigger purchase_register_append_only;

truncate public.purchase_register, public.bill_approvals, public.bills restart identity cascade;
delete from public.pda_balances;
delete from public.employees;
delete from public.counters;

-- ---------------------------------------------------------------- staff
-- The people who run the workflow. Codes follow one scheme throughout:
--   F####  faculty      D##/S##/B##  research / masters / undergrad
--   ADM### administrative staff
insert into public.employees (employee_code, employee_name, email, department, employee_type) values
  ('ADM001', 'Prof. Ramesh Chandra Deka', 'dean.finance@iitmandi.ac.in',   'Deans',                          'Dean'),
  ('ADM010', 'Sanjay Kaul',               'sanjay.kaul@iitmandi.ac.in',    'Finance and Accounts',           'Finance Admin'),
  ('ADM011', 'Pooja Thakur',              'pooja.thakur@iitmandi.ac.in',   'Finance and Accounts',           'Finance Admin'),
  ('ADM020', 'Neha Gupta',                'neha.gupta@iitmandi.ac.in',     'Internal Audit',                 'Audit'),
  ('ADM021', 'Vikram Bhardwaj',           'vikram.b@iitmandi.ac.in',       'Internal Audit',                 'Audit'),
  ('ADM030', 'Rakesh Verma',              'rakesh.verma@iitmandi.ac.in',   'Store and Purchase Section',     'Student Purchase'),
  ('ADM031', 'Anjali Rana',               'anjali.rana@iitmandi.ac.in',    'Store and Purchase Section',     'Student Purchase'),
  ('ADM040', 'Suresh Kumar',              'suresh.kumar@iitmandi.ac.in',   'Finance and Accounts',           'PDA Manager'),
  ('ADM041', 'Kavita Sharma',             'kavita.sharma@iitmandi.ac.in',  'Finance and Accounts',           'PDA Manager'),
  ('ADM050', 'Deepak Negi',               'deepak.negi@iitmandi.ac.in',    'Store and Purchase Section',     'Bill Employee'),
  ('ADM051', 'Shalini Kaushik',           'shalini.k@iitmandi.ac.in',      'Academics Section',              'Bill Employee'),
  ('ADM052', 'Mohit Guleria',             'mohit.guleria@iitmandi.ac.in',  'Registrar Office',               'Bill Employee'),
  ('ADM060', 'Ritu Chauhan',              'ritu.chauhan@iitmandi.ac.in',   'Store and Purchase Section',     'Bill Editor');

-- ------------------------------------------------- faculty and students
do $$
declare
    v_schools text[] := array[
        'School of Computing & Electrical Engineering',
        'School of Chemical Sciences',
        'School of Physical Sciences',
        'School of Mathematical & Statistical Sciences',
        'School of Biosciences & Bio Engineering',
        'School of Mechanical & Materials Engineering',
        'School of Civil & Environmental Engineering',
        'School of Humanities & Social Sciences',
        'School of Management'
    ];
    v_first text[] := array['Aarav','Ishita','Rohan','Ananya','Karthik','Meera','Siddharth','Nandini',
                            'Aditya','Shreya','Vivek','Tanvi','Arjun','Divya','Harsh','Pallavi',
                            'Nikhil','Sneha','Rahul','Kritika','Manav','Aishwarya','Yash','Prerna',
                            'Gaurav','Ritika','Abhishek','Swati','Varun','Neelam'];
    v_last  text[] := array['Sharma','Thakur','Negi','Rao','Iyer','Bhat','Chauhan','Verma','Kapoor',
                            'Guleria','Sood','Mehta','Nair','Joshi','Rathore'];
    i integer;
    v_code text;
    v_name text;
    v_dept public.department;
    v_alloc numeric;
begin
    perform setseed(0.42);   -- deterministic: the same demo data every time

    -- 10 faculty, generous PDA
    for i in 1..10 loop
        v_code := 'F' || lpad((1200 + i)::text, 4, '0');
        v_name := 'Dr. ' || v_first[1 + (i * 3) % array_length(v_first,1)]
                          || ' ' || v_last[1 + (i * 5) % array_length(v_last,1)];
        v_dept := v_schools[1 + (i - 1) % array_length(v_schools,1)]::public.department;
        v_alloc := (400000 + floor(random() * 15) * 50000)::numeric(12,2);

        insert into public.employees (employee_code, employee_name, email, department, employee_type)
        values (v_code, v_name, lower(v_code) || '@iitmandi.ac.in', v_dept, 'User');
        insert into public.pda_balances (employee_id, email, department, allocated, balance)
        values (v_code, lower(v_code) || '@iitmandi.ac.in', v_dept, v_alloc, v_alloc);
    end loop;

    -- 12 PhD scholars
    for i in 1..12 loop
        v_code := 'D' || (21 + i % 4)::text || lpad((100 + i)::text, 3, '0');
        v_name := v_first[1 + (i * 7) % array_length(v_first,1)]
                  || ' ' || v_last[1 + (i * 2) % array_length(v_last,1)];
        v_dept := v_schools[1 + (i + 2) % array_length(v_schools,1)]::public.department;
        v_alloc := (120000 + floor(random() * 9) * 20000)::numeric(12,2);

        insert into public.employees (employee_code, employee_name, email, department, employee_type)
        values (v_code, v_name, lower(v_code) || '@students.iitmandi.ac.in', v_dept, 'User');
        insert into public.pda_balances (employee_id, email, department, allocated, balance)
        values (v_code, lower(v_code) || '@students.iitmandi.ac.in', v_dept, v_alloc, v_alloc);
    end loop;

    -- 8 masters students
    for i in 1..8 loop
        v_code := 'S' || (23 + i % 2)::text || lpad((200 + i)::text, 3, '0');
        v_name := v_first[1 + (i * 11) % array_length(v_first,1)]
                  || ' ' || v_last[1 + (i * 4) % array_length(v_last,1)];
        v_dept := v_schools[1 + (i + 5) % array_length(v_schools,1)]::public.department;
        v_alloc := (60000 + floor(random() * 7) * 10000)::numeric(12,2);

        insert into public.employees (employee_code, employee_name, email, department, employee_type)
        values (v_code, v_name, lower(v_code) || '@students.iitmandi.ac.in', v_dept, 'User');
        insert into public.pda_balances (employee_id, email, department, allocated, balance)
        values (v_code, lower(v_code) || '@students.iitmandi.ac.in', v_dept, v_alloc, v_alloc);
    end loop;
end $$;

-- The staff who run the workflow also hold small PDAs of their own.
insert into public.pda_balances (employee_id, email, department, allocated, balance)
select employee_code, email, department, 150000, 150000
from public.employees
where employee_type in ('Bill Employee', 'Bill Editor', 'Student Purchase', 'Audit');

-- ---------------------------------------------------------------- bills
do $$
declare
    v_items_major text[] := array[
        'Keysight DSOX1204G oscilloscope',
        'Fume hood with scrubber unit',
        'Thermo Scientific centrifuge, refrigerated',
        'CNC benchtop milling machine',
        'Rotary vacuum pump, two stage',
        'Server node, 2x Xeon Silver, 256 GB RAM',
        'Universal testing machine, 50 kN',
        'Confocal microscope objective set',
        'Environmental chamber, 150 L',
        'GPU workstation, RTX A5000'];
    v_items_minor text[] := array[
        'Soldering station, temperature controlled',
        'Digital vernier calliper set',
        'Laboratory hot plate with magnetic stirrer',
        'Precision weighing balance, 0.1 mg',
        'Tripod and camera mount for field survey',
        'Portable spectrum analyser',
        'Ultrasonic cleaner, 6 L',
        'Benchtop pH meter with electrodes',
        'Hand-held thermal imager',
        'Network switch, 24 port managed'];
    v_items_cons text[] := array[
        'Nitrile examination gloves, 20 boxes',
        'Analytical grade acetonitrile, 5 L',
        'Printer toner cartridges, set of 4',
        'Borosilicate glassware replacement set',
        'A4 paper, 30 reams',
        'Pipette tips, sterile, 10 racks',
        'Silica gel desiccant, 25 kg',
        'Chart recorder paper and pens',
        'Copper clad laminate sheets, 20 nos',
        'Distilled water, 50 L'];
    v_suppliers text[] := array[
        'Scientific Traders, Mandi',
        'Himalayan Lab Supplies, Shimla',
        'Precision Instruments Pvt Ltd, Chandigarh',
        'Northern Scientific Corporation, New Delhi',
        'Agilent Technologies India',
        'Spectra Chem Agencies, Ludhiana',
        'Kamla Enterprises, Mandi',
        'TechnoSource Systems, Noida',
        'Bharat Lab Equipments, Ambala',
        'Shivalik Traders, Sundernagar'];
    v_addr text[] := array[
        'Bhutti Colony, Mandi, Himachal Pradesh 175001',
        'The Mall, Shimla, Himachal Pradesh 171001',
        'Industrial Area Phase II, Chandigarh 160002',
        'Karol Bagh, New Delhi 110005',
        'Sector 62, Noida, Uttar Pradesh 201309'];
    v_funds text[] := array['Institute Plan Fund','SERB Core Research Grant','DST Project Grant',
                            'Institute Development Fund','CSIR Sponsored Project','PDA'];
    v_locations text[] := array['North Campus, Kamand','South Campus, Kamand','Mandi City Campus',
                                'A-11 Laboratory Block','Central Instrumentation Facility'];

    v_holders   text[];
    v_snp       text[] := array['ADM030','ADM031'];
    v_auditors  text[] := array['ADM020','ADM021'];
    v_finance   text[] := array['ADM010','ADM011'];
    v_filers    text[] := array['ADM050','ADM051','ADM052'];

    v_holder    text;
    v_actor     text;
    v_actor_nm  text;
    v_bill      jsonb;
    v_id        uuid;
    v_cat       text;
    v_stage     text;
    v_amount    numeric;
    v_item      text;
    v_avail     numeric;
    v_created   timestamptz;
    v_cursor    timestamptz;
    v_roll      numeric;
    v_made      integer := 0;
    i           integer;

    v_reject_reasons text[] := array[
        'Quotation is not from a GeM-registered vendor. Please re-tender.',
        'Sanction letter for the funding head is not attached.',
        'The rate quoted exceeds the DGS&D contract rate for this item.',
        'Stock entry number is missing; the item cannot be taken on charge.',
        'Three comparative quotations are required above this value.'];
    v_hold_reasons text[] := array[
        'Awaiting the indenter''s signature on the stock entry.',
        'Please attach the delivery challan before this can proceed.',
        'Held pending clarification on the warranty period.',
        'Budget head confirmation awaited from the project PI.'];
begin
    perform setseed(0.7);

    select array_agg(employee_id order by employee_id) into v_holders
      from public.pda_balances;

    for i in 1..165 loop
        v_holder := v_holders[1 + floor(random() * array_length(v_holders,1))::int];

        select balance into v_avail from public.pda_balances where employee_id = v_holder;
        if v_avail is null or v_avail < 3000 then
            continue;   -- this holder is tapped out; skip
        end if;

        -- category mix roughly matches a real school: mostly small purchases
        v_roll := random();
        if v_roll < 0.45 then
            v_cat  := 'Consumables';
            v_item := v_items_cons[1 + floor(random() * 10)::int];
            v_amount := (2000 + floor(random() * 60) * 1000)::numeric;
        elsif v_roll < 0.80 then
            v_cat  := 'Minor';
            v_item := v_items_minor[1 + floor(random() * 10)::int];
            v_amount := (8000 + floor(random() * 70) * 1000)::numeric;
        else
            v_cat  := 'Major';
            v_item := v_items_major[1 + floor(random() * 10)::int];
            v_amount := (50000 + floor(random() * 40) * 5000)::numeric;
        end if;

        if v_amount > v_avail then
            v_amount := floor(v_avail / 1000) * 1000;
        end if;
        continue when v_amount < 1000;

        v_created := now() - (random() * interval '180 days');
        v_actor   := v_filers[1 + floor(random() * 3)::int];

        v_bill := public.fn_submit_bill(
            jsonb_build_object(
                'employee_id',      v_holder,
                'po_value',         v_amount,
                'item_category',    v_cat,
                'item_description', v_item,
                'qty',              (1 + floor(random() * 5))::int,
                'qty_issued',       (1 + floor(random() * 5))::int,
                'po_details',       'PO/' || to_char(v_created,'YYYY') || '/' || lpad((1000 + i)::text,4,'0'),
                'supplier_name',    v_suppliers[1 + floor(random() * 10)::int],
                'supplier_address', v_addr[1 + floor(random() * 5)::int],
                'source_of_fund',   v_funds[1 + floor(random() * 6)::int],
                'location',         v_locations[1 + floor(random() * 5)::int],
                'stock_entry',      'SE/' || lpad((500 + i)::text,4,'0'),
                'indenter_name',    (select employee_name from public.employees where employee_code = v_holder),
                'bill_details',     'Invoice ' || lpad((7000 + i)::text,5,'0')
                                    || ' dated ' || to_char(v_created,'DD.MM.YYYY')
            ),
            jsonb_build_object('code', v_actor, 'role', 'Bill Employee',
                'name', (select employee_name from public.employees where employee_code = v_actor)));

        v_id      := (v_bill->>'id')::uuid;
        v_cursor  := v_created;
        v_made    := v_made + 1;

        -- Now walk it forward. ~15% of bills are left sitting where they are.
        <<walk>>
        loop
            exit walk when random() < 0.15;

            select status into v_stage from public.bills where id = v_id;
            exit walk when v_stage in ('Accepted','Rejected');

            v_cursor := v_cursor + (interval '1 day' * (1 + random() * 6));
            exit walk when v_cursor > now();

            v_actor := case v_stage
                when 'Student Purchase' then v_snp[1 + floor(random() * 2)::int]
                when 'Audit'            then v_auditors[1 + floor(random() * 2)::int]
                else                         v_finance[1 + floor(random() * 2)::int]
            end;
            select employee_name into v_actor_nm from public.employees where employee_code = v_actor;

            v_roll := random();
            if v_roll < 0.10 then
                perform public.fn_bill_action(v_id, v_actor, v_actor_nm, v_stage, 'Rejected',
                    v_reject_reasons[1 + floor(random() * 5)::int]);
                exit walk;
            elsif v_roll < 0.18 then
                perform public.fn_bill_action(v_id, v_actor, v_actor_nm, v_stage, 'Hold',
                    v_hold_reasons[1 + floor(random() * 4)::int]);
                -- a held bill usually clears a few days later
                if random() < 0.6 then
                    v_cursor := v_cursor + (interval '1 day' * (1 + random() * 5));
                    exit walk when v_cursor > now();
                    perform public.fn_bill_action(v_id, v_actor, v_actor_nm, v_stage, 'Approved',
                        'Clarification received. Cleared.',
                        case when v_stage = 'Student Purchase' and random() < 0.35
                             then jsonb_build_object('has_bank_guarantee', true,
                                    'bank_guarantee_details','BG/PNB/'||to_char(v_cursor,'YYYY')||'/'||lpad((100+i)::text,3,'0'),
                                    'bank_guarantee_amount', round(v_amount * 0.1)::text)
                             else '{}'::jsonb end);
                else
                    exit walk;
                end if;
            else
                perform public.fn_bill_action(v_id, v_actor, v_actor_nm, v_stage, 'Approved',
                    case v_stage
                      when 'Student Purchase' then 'Verified against the indent and the store record.'
                      when 'Audit'            then 'Rates and sanction verified. In order.'
                      else                         'Passed for payment.'
                    end,
                    case when v_stage = 'Student Purchase' and random() < 0.35
                         then jsonb_build_object('has_bank_guarantee', true,
                                'bank_guarantee_details','BG/SBI/'||to_char(v_cursor,'YYYY')||'/'||lpad((100+i)::text,3,'0'),
                                'bank_guarantee_amount', round(v_amount * 0.1)::text,
                                'date_of_delivery', (v_cursor + interval '14 days')::text,
                                'date_of_installation', (v_cursor + interval '21 days')::text)
                         else '{}'::jsonb end);
            end if;
        end loop walk;

        -- Back-date the whole trail so the demo looks lived-in.
        update public.bills set created_at = v_created,
               decided_at = case when decided_at is not null then v_cursor end,
               updated_at = greatest(v_created, v_cursor)
         where id = v_id;

        update public.bill_approvals a
           set created_at = v_created + (interval '1 day' * (a.seq - 1) * 1.5)
         where a.bill_id = v_id;

        update public.purchase_register
           set recorded_at = v_cursor, entry_date = v_cursor::date
         where bill_id = v_id;
    end loop;

    raise notice 'seeded % bills', v_made;
end $$;

-- ------------------------------------------------------- demo logins
-- These are the fixed accounts the login page accepts with password "123"
-- while the portal is running off the institute network. Every one of them
-- resolves to a real row here, so the role always comes from the database.
-- Remove this block, and DEMO_LOGIN_ENABLED, for the production deploy.
insert into public.employees (employee_code, employee_name, email, department, employee_type) values
  ('Dean',          'Demo Dean of Finance',  'demo.dean@iitmandi.ac.in',    'Deans',                      'Dean'),
  ('Finance Admin', 'Demo Finance Admin',    'demo.finance@iitmandi.ac.in', 'Finance and Accounts',       'Finance Admin'),
  ('Audit',         'Demo Auditor',          'demo.audit@iitmandi.ac.in',   'Internal Audit',             'Audit'),
  ('SNP',           'Demo Store & Purchase', 'demo.snp@iitmandi.ac.in',     'Store and Purchase Section', 'Student Purchase'),
  ('Bill-form',     'Demo Bill Filer',       'demo.billform@iitmandi.ac.in','Store and Purchase Section', 'Bill Employee'),
  ('Bill-edit',     'Demo Bill Editor',      'demo.billedit@iitmandi.ac.in','Store and Purchase Section', 'Bill Editor'),
  ('pda manager',   'Demo PDA Manager',      'demo.pda@iitmandi.ac.in',     'Finance and Accounts',       'PDA Manager'),
  ('User',          'Demo User',             'demo.user@iitmandi.ac.in',    'School of Computing & Electrical Engineering', 'User'),
  ('E001', 'Aarav Sharma',   'e001@students.iitmandi.ac.in', 'School of Computing & Electrical Engineering',  'User'),
  ('E002', 'Ishita Rao',     'e002@students.iitmandi.ac.in', 'School of Chemical Sciences',                   'User'),
  ('E003', 'Rohan Negi',     'e003@students.iitmandi.ac.in', 'School of Physical Sciences',                   'User'),
  ('E004', 'Ananya Iyer',    'e004@students.iitmandi.ac.in', 'School of Biosciences & Bio Engineering',       'User'),
  ('E005', 'Karthik Bhat',   'e005@students.iitmandi.ac.in', 'School of Mechanical & Materials Engineering',  'User'),
  ('E006', 'Meera Chauhan',  'e006@students.iitmandi.ac.in', 'School of Civil & Environmental Engineering',   'User'),
  ('E007', 'Siddharth Sood', 'e007@students.iitmandi.ac.in', 'School of Mathematical & Statistical Sciences', 'User'),
  ('E008', 'Nandini Kapoor', 'e008@students.iitmandi.ac.in', 'School of Humanities & Social Sciences',        'User');

-- Give the demo users something to spend, and the demo staff a PDA too.
insert into public.pda_balances (employee_id, email, department, allocated, balance)
select employee_code, email, department, 250000, 250000
from public.employees
where employee_code in ('User','E001','E002','E003','E004','E005','E006','E007','E008',
                        'Bill-form','Bill-edit','SNP','Audit','Finance Admin','pda manager','Dean');

-- Put a few live bills on the demo users so their pages are not empty.
do $$
declare v_codes text[] := array['E001','E002','E003','User'];
        v_id uuid; v_bill jsonb; c text; i integer;
        v_stage text; v_actor text; v_actor_nm text;
begin
    perform setseed(0.9);
    foreach c in array v_codes loop
        for i in 1..4 loop
            v_bill := public.fn_submit_bill(
                jsonb_build_object(
                    'employee_id', c,
                    'po_value', (5000 + i * 17000)::numeric,
                    'item_category', (array['Consumables','Minor','Major','Minor'])[i],
                    'item_description', (array['Pipette tips, sterile, 10 racks',
                                               'Benchtop pH meter with electrodes',
                                               'GPU workstation, RTX A5000',
                                               'Digital vernier calliper set'])[i],
                    'qty', i,
                    'supplier_name', 'Scientific Traders, Mandi',
                    'supplier_address', 'Bhutti Colony, Mandi, Himachal Pradesh 175001',
                    'source_of_fund', 'Institute Plan Fund',
                    'location', 'North Campus, Kamand',
                    'stock_entry', 'SE/DEMO/' || i,
                    'po_details', 'PO/DEMO/' || c || '/' || i,
                    'indenter_name', (select employee_name from public.employees where employee_code = c)),
                '{"code":"Bill-form","name":"Demo Bill Filer","role":"Bill Employee"}'::jsonb);
            v_id := (v_bill->>'id')::uuid;

            -- leave #1 where it lands, approve #2 all the way, reject #3
            -- Each desk is worked by somebody who actually holds that role,
            -- so the demo timeline reads the way a real one would.
            if i = 2 then
                loop
                    select status into v_stage from public.bills where id = v_id;
                    exit when v_stage in ('Accepted', 'Rejected');

                    select employee_code, employee_name into v_actor, v_actor_nm
                      from public.employees
                     where employee_type = v_stage and employee_code like 'ADM%'
                     order by employee_code limit 1;

                    perform public.fn_bill_action(v_id, v_actor, v_actor_nm, v_stage,
                        'Approved',
                        case v_stage
                          when 'Student Purchase' then 'Verified against the indent and the store record.'
                          when 'Audit'            then 'Rates and sanction verified. In order.'
                          else                         'Passed for payment.'
                        end);
                end loop;

            elsif i = 3 then
                select status into v_stage from public.bills where id = v_id;
                select employee_code, employee_name into v_actor, v_actor_nm
                  from public.employees
                 where employee_type = v_stage and employee_code like 'ADM%'
                 order by employee_code limit 1;

                perform public.fn_bill_action(v_id, v_actor, v_actor_nm, v_stage, 'Rejected',
                    'Three comparative quotations are required above this value.');
            end if;
        end loop;
    end loop;
end $$;

-- ---------------------------------------------------------------- restore
alter table public.bill_approvals    enable trigger bill_approvals_append_only;
alter table public.purchase_register enable trigger purchase_register_append_only;

commit;

-- ---------------------------------------------------------------- summary
\echo ''
\echo '--- demo dataset ---'
select 'employees' as table, count(*) from public.employees
union all select 'pda accounts',       count(*) from public.pda_balances
union all select 'bills',              count(*) from public.bills
union all select 'workflow events',    count(*) from public.bill_approvals
union all select 'register entries',   count(*) from public.purchase_register;

select status, count(*), to_char(sum(po_value),'FM99,99,99,990') as total_rs
from public.bills group by status order by count(*) desc;

select 'PDA invariant holds' as check,
       (count(*) = 0) as ok
from public.pda_balances where allocated <> balance + committed + spent;
