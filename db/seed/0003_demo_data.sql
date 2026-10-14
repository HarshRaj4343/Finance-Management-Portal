-- Optional demo accounts only; run manually on a demo database after migrations.
-- No table truncation, trigger disabling, balance resets or fabricated bill history.
-- Existing accounts (including inactive accounts) are never changed or reactivated.
begin;
select set_config('app.actor_code', 'demo-seed', true);
with inserted as (
insert into public.employees (employee_code, employee_name, email, department, employee_type) values
  ('Dean',          'Demo Dean of Finance',  'demo.dean@iitmandi.ac.in',    'Deans',                      'Dean'),
  ('Finance Admin', 'Demo Finance Admin',    'demo.finance@iitmandi.ac.in', 'Finance and Accounts',       'Finance Admin'),
  ('Audit',         'Demo Auditor',          'demo.audit@iitmandi.ac.in',   'Internal Audit',             'Audit'),
  ('SNP',           'Demo Store & Purchase', 'demo.snp@iitmandi.ac.in',     'Store and Purchase Section', 'Student Purchase'),
  ('Bill-form',     'Demo Bill Filer',       'demo.billform@iitmandi.ac.in','Store and Purchase Section', 'Bill Employee'),
  ('pda manager',   'Demo PDA Manager',      'demo.pda@iitmandi.ac.in',     'Finance and Accounts',       'PDA Manager'),
  ('User',          'Demo User',             'demo.user@iitmandi.ac.in',    'School of Computing & Electrical Engineering', 'User'),
  ('E001', 'Aarav Sharma',   'e001@students.iitmandi.ac.in', 'School of Computing & Electrical Engineering',  'User'),
  ('E002', 'Ishita Rao',     'e002@students.iitmandi.ac.in', 'School of Chemical Sciences',                   'User'),
  ('E003', 'Rohan Negi',     'e003@students.iitmandi.ac.in', 'School of Physical Sciences',                   'User'),
  ('E004', 'Ananya Iyer',    'e004@students.iitmandi.ac.in', 'School of Biosciences & Bio Engineering',       'User'),
  ('E005', 'Karthik Bhat',   'e005@students.iitmandi.ac.in', 'School of Mechanical & Materials Engineering',  'User'),
  ('E006', 'Meera Chauhan',  'e006@students.iitmandi.ac.in', 'School of Civil & Environmental Engineering',   'User'),
  ('E007', 'Siddharth Sood', 'e007@students.iitmandi.ac.in', 'School of Mathematical & Statistical Sciences', 'User'),
  ('E008', 'Nandini Kapoor', 'e008@students.iitmandi.ac.in', 'School of Humanities & Social Sciences',        'User')
on conflict do nothing
returning employee_code, email, department
)
insert into public.pda_balances (employee_id, email, department, allocated, balance)
select employee_code, email, department, 250000, 250000 from inserted
on conflict do nothing;
commit;
