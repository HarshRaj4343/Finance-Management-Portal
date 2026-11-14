import { NextRequest } from "next/server";
import { query, queryOne, Params, whereClause, likePattern } from "@/server/db";
import { HttpError, requireActor } from "@/server/session";
import { CSV_ROW_LIMIT, columnsResponse, csvResponse, isoDay, istStamp, pickColumns, toCsv, type CsvColumn } from "@/server/csv";
import type { PurchaseRegisterRow } from "@/types/database";
import { fail, ok } from "@/server/http";
import { canOpenPurchaseRegister, seesOwnFilingsOnly } from "@/lib/roles";
import { pagination } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CSV_COLUMNS: CsvColumn<PurchaseRegisterRow>[] = [
  ["Serial no.", (e) => e.serial_no], ["Entry date", (e) => e.entry_date], ["Financial year", (e) => e.financial_year],
  ["Bill number", (e) => e.bill_number], ["Department", (e) => e.department], ["Employee ID", (e) => e.employee_code],
  ["Employee name", (e) => e.employee_name], ["Indenter", (e) => e.indenter_name], ["Item", (e) => e.item_description],
  ["Category", (e) => e.item_category], ["Quantity", (e) => e.qty], ["Supplier", (e) => e.supplier_name],
  ["Supplier address", (e) => e.supplier_address], ["Amount (INR)", (e) => Number(e.amount).toFixed(2)],
  ["Source of fund", (e) => e.source_of_fund], ["Stock entry", (e) => e.stock_entry], ["Location", (e) => e.location],
  ["Recorded by", (e) => e.recorded_by], ["Recorded at (IST)", (e) => istStamp(e.recorded_at)],
  ["Register no.", (e) => e.register_name], ["Register page no.", (e) => e.register_page], ["Register serial no.", (e) => e.register_serial],
];

/**
 * The register with where each purchase was entered in the physical
 * registers (register no., page, serial), kept on the bill. Wrapped so
 * every filter below keeps addressing plain column names.
 */
const REGISTER = `(select r.*, b.register_name, b.register_page, b.register_serial
                     from public.purchase_register r left join public.bills b on b.id = r.bill_id) purchase_register`;

/**
 * GET /api/register  --  the departmental purchase register.
 *
 * The official record of what was actually bought: one row per finally
 * approved purchase, with the running serial number it was entered under.
 * Append-only in the database; there is deliberately no write endpoint.
 * Open to the Dean and the Store and Purchase Department; a bill filer
 * sees only the purchases of bills they filed.
 * Entries are cut by fn_bill_action at the moment of final approval.
 *
 *   ?department= &fy= &category= &source= &q= &from= &to= &limit= &offset=
 *   ?format=csv[&col=..]  spreadsheet of the chosen columns; ?format=columns lists them
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireActor();
    if (!canOpenPurchaseRegister(actor.role)) throw new HttpError(403, "Only the Dean, Store and Purchase and bill filers can open the purchase register.");
    const p = req.nextUrl.searchParams;
    if (p.get("format") === "columns") return columnsResponse(CSV_COLUMNS);

    const { limit, offset } = pagination(p);

    const params = new Params();
    const where: string[] = [];

    // A filer sees the purchases of the bills they filed, nobody else's. Not negotiable.
    const own = seesOwnFilingsOnly(actor.role);
    if (own) where.push(`bill_id in (select id from public.bills where created_by = ${params.add(actor.code)})`);

    if (p.get("department")) where.push(`department::text = ${params.add(p.get("department"))}`);
    if (p.get("fy")) where.push(`financial_year = ${params.add(p.get("fy"))}`);
    if (p.get("category")) where.push(`item_category = ${params.add(p.get("category"))}`);
    if (p.get("source")) where.push(`source_of_fund = ${params.add(p.get("source"))}`);
    const from = isoDay(p.get("from")), to = isoDay(p.get("to"));
    if (from) where.push(`entry_date >= ${params.add(from)}::date`);
    if (to) where.push(`entry_date <= ${params.add(to)}::date`);

    const text = p.get("q")?.trim();
    if (text) {
      const like = params.add(likePattern(text));
      where.push(
        `(serial_no ilike ${like} or item_description ilike ${like}
          or supplier_name ilike ${like} or employee_name ilike ${like}
          or employee_code ilike ${like} or bill_number ilike ${like}
          or register_name ilike ${like} or register_page ilike ${like} or register_serial ilike ${like})`
      );
    }

    const filter = whereClause(where);
    const filterValues = [...params.values];

    // ?format=csv: every entry matching these filters, as a spreadsheet.
    if (p.get("format") === "csv") {
      const rows = await query<PurchaseRegisterRow>(
        `select * from ${REGISTER} ${filter} order by recorded_at desc, id desc limit ${CSV_ROW_LIMIT}`, filterValues);
      return csvResponse(`purchase-register-${p.get("fy") || "all-years"}.csv`, toCsv(pickColumns(CSV_COLUMNS, p), rows));
    }
    const page = `limit ${params.add(limit)} offset ${params.add(offset)}`;

    const [entries, counted, totals, years] = await Promise.all([
      query(
        `select * from ${REGISTER} ${filter}
         order by recorded_at desc, id desc ${page}`,
        params.values
      ),
      queryOne<{ total: number }>(
        `select count(*) as total from ${REGISTER} ${filter}`,
        filterValues
      ),
      queryOne<{ totals: unknown }>(
        `select jsonb_build_object('entries', count(*), 'amount', coalesce(sum(amount),0),
          'departments', count(distinct department), 'financial_year', $${filterValues.length + 1}::text,
          'current_year', public.fn_financial_year()) as totals
          from ${REGISTER} ${filter}`,
        [...filterValues, p.get("fy")]
      ),
      query<{ financial_year: string }>(
        `select distinct financial_year from public.purchase_register
          ${own ? "where bill_id in (select id from public.bills where created_by = $1)" : ""} order by financial_year desc`,
        own ? [actor.code] : []
      ),
    ]);

    return ok({
      entries,
      total: counted?.total ?? 0,
      limit,
      offset,
      totals: totals?.totals ?? null,
      financialYears: years.map((row) => row.financial_year),
    });
  } catch (err) {
    return fail(err, "Could not load the purchase register.");
  }
}
