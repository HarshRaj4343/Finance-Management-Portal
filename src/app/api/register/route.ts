import { NextRequest } from "next/server";
import { query, queryOne, Params, whereClause, likePattern } from "@/server/db";
import { HttpError, requireActor } from "@/server/session";
import { CSV_ROW_LIMIT, columnsResponse, csvResponse, isoDay, istStamp, pickColumns, toCsv, type CsvColumn } from "@/server/csv";
import type { PurchaseRegisterRow } from "@/types/database";
import { fail, ok } from "@/server/http";
import { canSeeAllBills } from "@/lib/roles";
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
];

/**
 * GET /api/register  --  the departmental purchase register.
 *
 * The official record of what was actually bought: one row per finally
 * approved purchase, with the running serial number it was entered under.
 * Append-only in the database; there is deliberately no write endpoint.
 * Entries are cut by fn_bill_action at the moment of final approval.
 *
 *   ?department= &fy= &category= &source= &q= &from= &to= &limit= &offset=
 *   ?format=csv[&col=..]  spreadsheet of the chosen columns; ?format=columns lists them
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireActor();
    // RBAC: the purchase register is open to the Dean only.
    if (actor.role !== "Dean") throw new HttpError(403, "Only the Dean can open the purchase register.");
    const p = req.nextUrl.searchParams;
    if (p.get("format") === "columns") return columnsResponse(CSV_COLUMNS);

    const { limit, offset } = pagination(p);

    const params = new Params();
    const where: string[] = [];

    // A plain user sees their own purchases in the register, nobody else's.
    if (!canSeeAllBills(actor.role)) {
      where.push(`employee_code = ${params.add(actor.code)}`);
    }

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
          or employee_code ilike ${like} or bill_number ilike ${like})`
      );
    }

    const filter = whereClause(where);
    const filterValues = [...params.values];

    // ?format=csv: every entry matching these filters, as a spreadsheet.
    if (p.get("format") === "csv") {
      const rows = await query<PurchaseRegisterRow>(
        `select * from public.purchase_register ${filter} order by recorded_at desc, id desc limit ${CSV_ROW_LIMIT}`, filterValues);
      return csvResponse(`purchase-register-${p.get("fy") || "all-years"}.csv`, toCsv(pickColumns(CSV_COLUMNS, p), rows));
    }
    const page = `limit ${params.add(limit)} offset ${params.add(offset)}`;

    const [entries, counted, totals, years] = await Promise.all([
      query(
        `select * from public.purchase_register ${filter}
         order by recorded_at desc, id desc ${page}`,
        params.values
      ),
      queryOne<{ total: number }>(
        `select count(*) as total from public.purchase_register ${filter}`,
        filterValues
      ),
      queryOne<{ totals: unknown }>(
        `select jsonb_build_object('entries', count(*), 'amount', coalesce(sum(amount),0),
          'departments', count(distinct department), 'financial_year', $${filterValues.length + 1}::text,
          'current_year', public.fn_financial_year()) as totals
          from public.purchase_register ${filter}`,
        [...filterValues, p.get("fy")]
      ),
      query<{ financial_year: string }>(
        `select distinct financial_year from public.purchase_register ${!canSeeAllBills(actor.role) ? 'where employee_code = $1' : ''} order by financial_year desc`,
        !canSeeAllBills(actor.role) ? [actor.code] : []
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
