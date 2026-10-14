import { NextRequest } from "next/server";
import { Params, likePattern, query, queryOne, whereClause } from "@/server/db";
import { HttpError, requireActor } from "@/server/session";
import { CSV_ROW_LIMIT, csvResponse, istStamp, toCsv } from "@/server/csv";
import { fail, ok, badRequest } from "@/server/http";
import { pagination } from "@/lib/security";
import { canOpenMovementRegister } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DESKS = ["Student Purchase", "Audit", "Finance Admin"];

/**
 * GET /api/movements?register=Inward|Outward[&desk=Audit][&fy=2026-27][&q=]
 *
 * The inward (diary) and outward (dispatch) registers of the bill flow,
 * newest first. Open to the Dean and the three approval desks only.
 * Outward rows carry how long the bill spent at that desk.
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireActor();
    if (!canOpenMovementRegister(actor.role)) {
      throw new HttpError(403, "Only the Dean, Finance Admin, Audit and Store and Purchase can open the inward / outward register.");
    }
    const p = req.nextUrl.searchParams;
    const register = p.get("register") ?? "Inward";
    if (!["Inward", "Outward"].includes(register)) return badRequest("Choose the inward or outward register.");
    const { limit, offset } = pagination(p);

    const params = new Params();
    const where = [`m.register = ${params.add(register)}`];
    const desk = p.get("desk");
    if (desk) {
      if (!DESKS.includes(desk)) return badRequest("Choose a desk.");
      where.push(`m.desk = ${params.add(desk)}`);
    }
    const fy = p.get("fy");
    if (fy) {
      if (!/^\d{4}-\d{2}$/.test(fy)) return badRequest("Choose a financial year such as 2026-27.");
      where.push(`m.financial_year = ${params.add(fy)}`);
    }
    const text = p.get("q")?.trim();
    if (text) {
      const like = params.add(likePattern(text));
      where.push(`(m.serial_no ilike ${like} or m.bill_number ilike ${like} or m.employee_name ilike ${like}
        or m.employee_id ilike ${like} or m.item_description ilike ${like} or m.counterpart ilike ${like} or m.actor_name ilike ${like})`);
    }
    const filter = whereClause(where);
    const filterValues = [...params.values];

    // ?format=csv: the whole register for these filters, as a spreadsheet.
    if (p.get("format") === "csv") {
      type Row = Record<string, unknown>;
      const rows = await query<Row>(
        `select m.*, case when m.nature = 'New bill' then null else m.remark end as shown_remark,
                case when m.register = 'Outward' then round(extract(epoch from m.moved_at - (
                  select max(i.moved_at) from public.bill_movements i
                   where i.bill_id = m.bill_id and i.desk = m.desk and i.register = 'Inward' and i.moved_at <= m.moved_at)) / 3600, 2) end as hours_at_desk
           from public.bill_movements m ${filter} order by m.moved_at desc, m.id desc limit ${CSV_ROW_LIMIT}`, filterValues);
      const inward = register === "Inward";
      return csvResponse(`${register.toLowerCase()}-register-${desk ? desk.replace(/\s+/g, "-").toLowerCase() : "all-desks"}-${fy || "all-years"}.csv`, toCsv<Row>([
        [inward ? "Inward no." : "Outward no.", (r) => r.serial_no], [inward ? "Received (IST)" : "Dispatched (IST)", (r) => istStamp(r.moved_at)],
        ["Desk", (r) => r.desk === "Student Purchase" ? "Store and Purchase Department" : r.desk], ["Financial year", (r) => r.financial_year],
        ["Bill number", (r) => r.bill_number], ["Item", (r) => r.item_description], ["Applicant ID", (r) => r.employee_id],
        ["Applicant", (r) => r.employee_name], ["Department", (r) => r.department], ["Amount (INR)", (r) => r.amount == null ? "" : Number(r.amount).toFixed(2)],
        [inward ? "From" : "To", (r) => r.counterpart], ["Movement", (r) => r.nature], ["By", (r) => r.actor_name ?? r.actor_code],
        ...(inward ? [] : [["Hours at desk", (r: Row) => r.hours_at_desk] as [string, (r: Row) => unknown]]),
        ["Remarks", (r) => r.shown_remark],
      ], rows));
    }
    const page = `limit ${params.add(limit)} offset ${params.add(offset)}`;

    const [entries, counted, years] = await Promise.all([
      query(
        `select m.id, m.register, m.desk, m.financial_year, m.serial_no, m.bill_id, m.bill_number,
                m.employee_id, m.employee_name, m.department, m.item_description, m.amount,
                m.counterpart, m.nature, m.actor_code, m.actor_name, m.actor_role,
                -- The filing event's remark is the system's own reservation note, not a person's remark.
                case when m.nature = 'New bill' then null else m.remark end as remark, m.moved_at,
                case when m.register = 'Outward' then
                  extract(epoch from m.moved_at - (
                    select max(i.moved_at) from public.bill_movements i
                     where i.bill_id = m.bill_id and i.desk = m.desk and i.register = 'Inward' and i.moved_at <= m.moved_at))
                end as seconds_at_desk
           from public.bill_movements m ${filter}
          order by m.moved_at desc, m.id desc ${page}`,
        params.values
      ),
      queryOne<{ total: number }>(`select count(*) as total from public.bill_movements m ${filter}`, filterValues),
      query<{ financial_year: string }>("select distinct financial_year from public.bill_movements order by financial_year desc"),
    ]);
    return ok({ entries, total: counted?.total ?? 0, limit, offset, financialYears: years.map((y) => y.financial_year) });
  } catch (err) {
    return fail(err, "Could not load the register.");
  }
}
