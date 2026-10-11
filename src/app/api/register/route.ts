import { NextRequest } from "next/server";
import { query, queryOne, Params, whereClause, likePattern } from "@/server/db";
import { requireActor } from "@/server/session";
import { fail, ok } from "@/server/http";
import { canSeeAllBills } from "@/lib/roles";
import { pagination } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/register  --  the departmental purchase register.
 *
 * The official record of what was actually bought: one row per finally
 * approved purchase, with the running serial number it was entered under.
 * Append-only in the database; there is deliberately no write endpoint.
 * Entries are cut by fn_bill_action at the moment of final approval.
 *
 *   ?department= &fy= &q= &from= &to= &limit= &offset=
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireActor();
    const p = req.nextUrl.searchParams;

    const { limit, offset } = pagination(p);

    const params = new Params();
    const where: string[] = [];

    // A plain user sees their own purchases in the register, nobody else's.
    if (!canSeeAllBills(actor.role)) {
      where.push(`employee_code = ${params.add(actor.code)}`);
    }

    if (p.get("department")) where.push(`department::text = ${params.add(p.get("department"))}`);
    if (p.get("fy")) where.push(`financial_year = ${params.add(p.get("fy"))}`);
    if (p.get("from")) where.push(`entry_date >= ${params.add(p.get("from"))}::date`);
    if (p.get("to")) where.push(`entry_date <= ${params.add(p.get("to"))}::date`);

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
