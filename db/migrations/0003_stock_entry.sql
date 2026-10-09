-- Additive migration: safe for an existing database. No historical entries
-- or financial records are rewritten.
begin;

create or replace function public.fn_system_stock_entry() returns trigger
language plpgsql as $fn$
begin
    if tg_op = 'INSERT' then
        -- Bill numbers already have a transaction-safe, unique FY counter.
        -- Reuse it for the stock reference rather than storing a paper page.
        if new.bill_number is null then
            raise exception 'A system bill number is required before assigning a stock entry.';
        end if;
        new.stock_entry := regexp_replace(new.bill_number, '^IITM/', 'STK/');
    else
        -- Corrections may not change a system-assigned reference.
        new.stock_entry := old.stock_entry;
    end if;
    return new;
end;
$fn$;

drop trigger if exists bills_system_stock_entry on public.bills;
create trigger bills_system_stock_entry
    before insert or update on public.bills
    for each row execute function public.fn_system_stock_entry();

commit;
