-- An actual pre-upgrade record, created using the original workflow.
-- Run only inside the isolated db:test cluster, before migration 0004.
insert into public.employees(employee_code, employee_name, email, department, employee_type) values
 ('LEGACY-U','Legacy applicant','legacy-u@example.test','School of Computing & Electrical Engineering','User'),
 ('LEGACY-C','Legacy clerk','legacy-c@example.test','School of Computing & Electrical Engineering','Bill Employee'),
 ('LEGACY-F','Legacy finance','legacy-f@example.test','Finance and Accounts','Finance Admin');
insert into public.pda_balances(employee_id,email,department,allocated,balance)
 values('LEGACY-U','legacy-u@example.test','School of Computing & Electrical Engineering',1000,1000);
do $$ declare b jsonb; begin
 b := public.fn_submit_bill('{"employee_id":"LEGACY-U","po_value":42,"item_category":"Consumables","qty":1,"supplier_name":"Legacy supplier"}',
   '{"code":"LEGACY-C","name":"Legacy clerk","role":"Bill Employee"}');
 perform public.fn_bill_action((b->>'id')::uuid,'LEGACY-F','Legacy finance','Finance Admin','Approved');
end $$;
