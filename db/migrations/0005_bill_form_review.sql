-- Additive and repeatable. No historical bills, balances or approval events are rewritten.
begin;
select pg_advisory_xact_lock(hashtext('ifmp:integrity-migration'));

create or replace function public.fn_validate_bill(p jsonb) returns void language plpgsql as $$
declare total numeric; line jsonb; q integer; issued integer; price numeric; purchase numeric;
  invoice_day date; delivery_day date; installation_day date;
begin
  if jsonb_typeof(p->'form_data') is distinct from 'object'
    or jsonb_typeof(p->'form_data'->'lines') is distinct from 'array'
    or jsonb_array_length(p->'form_data'->'lines') not between 1 and 100
    or p->'form_data'->>'declaration' is distinct from 'true'
    or p->'form_data'->>'totalConfirmed' is distinct from 'true'
    or p->'form_data'->>'delivered' is distinct from 'yes'
    or coalesce(p->>'item_category','') not in ('Major','Minor','Consumables')
    or coalesce(p->>'source_of_fund','') not in ('OH-31','OH-35','PDA')
    or coalesce(btrim(p->>'supplier_name'), '') = ''
    or coalesce(btrim(p->>'supplier_address'), '') = ''
    or coalesce(btrim(p->>'invoice_no'), '') = ''
    or coalesce(btrim(p->>'item_description'), '') = ''
    or coalesce((p->>'qty')::integer, 0) <= 0
    or p->>'qty_issued' is null or (p->>'qty_issued')::integer not between 0 and (p->>'qty')::integer
    or p->>'invoice_date' is null or p->>'date_of_delivery' is null then
    raise exception 'Incomplete or invalid bill details.';
  end if;
  invoice_day := (p->>'invoice_date')::date;
  delivery_day := (p->>'date_of_delivery')::date;
  if invoice_day > (now() at time zone 'Asia/Kolkata')::date
    or delivery_day > (now() at time zone 'Asia/Kolkata')::date
    or delivery_day < invoice_day then
    raise exception 'Bill date must be on or before delivery; dates cannot be in the future.';
  end if;
  if p->'form_data'->>'installRequired' = 'yes' then
    installation_day := (p->>'date_of_installation')::date;
    if installation_day is null or p->'form_data'->>'installDone' is distinct from 'yes'
      or installation_day < delivery_day or installation_day < invoice_day
      or installation_day > (now() at time zone 'Asia/Kolkata')::date then
      raise exception 'Completed installation must be on or after delivery and the bill date.';
    end if;
  elsif p->'form_data'->>'installRequired' is distinct from 'no' then
    raise exception 'Say whether installation is required.';
  end if;
  if p->'form_data'->>'billDate' is distinct from p->>'invoice_date'
    or p->'form_data'->>'deliveryDate' is distinct from p->>'date_of_delivery'
    or p->'form_data'->>'fund' is distinct from p->>'source_of_fund'
    or p->'form_data'->>'category' is distinct from p->>'item_category'
    or (p->'form_data'->>'installRequired' = 'yes' and p->'form_data'->>'installDate' is distinct from p->>'date_of_installation') then
    raise exception 'Bill fields must match the complete form.';
  end if;
  total := coalesce(nullif(regexp_replace(p->'form_data'->>'otherCharges', '[₹,\s]', '', 'g'),'')::numeric, 0);
  if total < 0 or total >= 'Infinity'::numeric then raise exception 'Invalid other charges.'; end if;
  for line in select value from jsonb_array_elements(p->'form_data'->'lines') loop
    q := (line->>'qty')::integer; issued := (line->>'qtyIssued')::integer;
    price := regexp_replace(line->>'unitPrice', '[₹,\s]', '', 'g')::numeric;
    if q is null or issued is null or price is null or q not between 1 and 999
      or issued not between 0 and q or price <= 0 or price >= 'Infinity'::numeric then
      raise exception 'Invalid item quantities or price.';
    end if;
    if p->>'item_category' = 'Consumables' and (
      coalesce(line->>'group','') not in ('Office and academic stationery','Laboratory chemicals','Laboratory consumables',
        'Scientific materials','Biological consumables','Computer consumables','Electrical and electronic consumables',
        'Mechanical and fabrication consumables','Maintenance consumables','Housekeeping consumables',
        'Water and wastewater treatment consumables','Research-specific consumables','Miscellaneous')
      or line->>'type' in ('Laptop','Notebook','MacBook','Desktop Computer','Monitor','CPU','Refrigerator','AC','Fan')) then
      raise exception 'Choose consumable items, not durable equipment.';
    end if;
    total := total + round(q * price, 2);
  end loop;
  if total <= 0 or total >= 'Infinity'::numeric or total <> (p->>'po_value')::numeric then
    raise exception 'The bill amount must equal the item total and other charges.';
  end if;
  purchase := nullif(regexp_replace(p->'form_data'->>'poValue', '[₹,\s]', '', 'g'),'')::numeric;
  if purchase is null or purchase <= 0 or purchase >= 'Infinity'::numeric
    or purchase <> round(purchase, 2) or purchase <> total then
    raise exception 'Bill total including quantities and extra charges must match the PO / purchase value.';
  end if;
end; $$;
commit;
