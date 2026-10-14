import { NextRequest } from "next/server";
import { query, queryOne } from "@/server/db";
import { HttpError, requireActor } from "@/server/session";
import { CSV_ROW_LIMIT, csvResponse, istStamp, toCsv } from "@/server/csv";
import { fail, ok, badRequest } from "@/server/http";
import { isMoney } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODES = ["OH-31", "OH-35"];

/** RBAC: the OH-31 and OH-35 registers are open to the Dean only. */
async function requireDean() {
  const actor = await requireActor();
  if (actor.role !== "Dean") throw new HttpError(403, "Only the Dean can open the OH-31 and OH-35 registers.");
  return actor;
}

/**
 * GET /api/fund-heads?code=OH-31[&fy=2026-27]
 *
 * The head's budget for every financial year it has been funded in, the
 * sanctions the Dean entered, and every bill movement against it, newest
 * first. Read straight from the append-only ledger in 0007_fund_heads.sql.
 */
export async function GET(req: NextRequest) {
  try {
    await requireDean();
    const code = req.nextUrl.searchParams.get("code") ?? "";
    if (!CODES.includes(code)) return badRequest("Choose OH-31 or OH-35.");
    const fy = req.nextUrl.searchParams.get("fy") || null;
    if (fy && !/^\d{4}-\d{2}$/.test(fy)) return badRequest("Choose a financial year such as 2026-27.");

    // ?format=csv: the head's full ledger (sanctions and every bill movement).
    if (req.nextUrl.searchParams.get("format") === "csv") {
      type Row = Record<string, unknown>;
      const rows = await query<Row>(
        `select e.recorded_at, e.entry_date, e.financial_year, e.kind, e.amount, e.reference, e.remarks, e.actor_code,
                b.bill_number, b.employee_id, b.employee_name, b.employee_department, b.item_description, r.serial_no
           from public.fund_head_entries e
           left join public.bills b on b.id = e.bill_id
           left join public.purchase_register r on r.bill_id = b.id
          where e.code = $1 and ($2::text is null or e.financial_year = $2)
          order by e.id limit ${CSV_ROW_LIMIT}`, [code, fy]);
      return csvResponse(`${code}-register-${fy || "all-years"}.csv`, toCsv<Row>([
        ["Recorded (IST)", (r) => istStamp(r.recorded_at)], ["Entry date", (r) => r.entry_date], ["Financial year", (r) => r.financial_year],
        ["Entry", (r) => r.kind === "Allocation" ? "Sanction" : r.kind],
        ["Amount (INR)", (r) => Number(r.amount).toFixed(2)],
        ["Effect on available (INR)", (r) => (r.kind === "Allocation" || r.kind === "Released" ? 1 : r.kind === "Reserved" ? -1 : 0) * Number(r.amount)],
        ["Sanction reference", (r) => r.reference], ["Bill number", (r) => r.bill_number], ["Register serial", (r) => r.serial_no],
        ["Applicant", (r) => r.employee_name], ["Applicant ID", (r) => r.employee_id], ["Department", (r) => r.employee_department],
        ["Item", (r) => r.item_description], ["Remarks", (r) => r.remarks], ["Entered by", (r) => r.actor_code],
      ], rows));
    }

    const [heads, allocations, movements, current] = await Promise.all([
      query(
        `select code, financial_year, allocated, balance, committed, spent, updated_at
           from public.fund_heads where code = $1 order by financial_year desc`, [code]),
      query(
        `select id, financial_year, amount, reference, entry_date::text as entry_date, remarks, actor_code, recorded_at
           from public.fund_head_entries
          where code = $1 and kind = 'Allocation' and ($2::text is null or financial_year = $2)
          order by id desc`, [code, fy]),
      query(
        `select e.id, e.financial_year, e.kind, e.amount, e.recorded_at, e.actor_code,
                b.id as bill_id, b.bill_number, b.employee_id, b.employee_name, b.employee_department,
                b.item_description, b.item_category, b.status, r.serial_no
           from public.fund_head_entries e
           join public.bills b on b.id = e.bill_id
           left join public.purchase_register r on r.bill_id = b.id
          where e.code = $1 and e.kind <> 'Allocation' and ($2::text is null or e.financial_year = $2)
          order by e.id desc limit 500`, [code, fy]),
      queryOne<{ fy: string }>("select public.fn_financial_year() as fy"),
    ]);
    return ok({ code, heads, allocations, movements, currentYear: current?.fy ?? null });
  } catch (err) {
    return fail(err, "Could not load the register.");
  }
}

/** POST /api/fund-heads  { code, financial_year, amount, reference, date?, remarks? } */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireDean();
    const b = (await req.json()) as Record<string, unknown>;
    const code = String(b.code ?? "");
    const fy = String(b.financial_year ?? "");
    const amount = Number(b.amount);
    const reference = String(b.reference ?? "").trim();
    const date = b.date ? String(b.date) : null;
    if (!CODES.includes(code)) return badRequest("Choose OH-31 or OH-35.");
    if (!/^\d{4}-\d{2}$/.test(fy)) return badRequest("Choose a financial year such as 2026-27.");
    if (!isMoney(amount) || amount <= 0) return badRequest("Enter a positive amount with at most two decimal places.");
    if (!reference || reference.length > 200) return badRequest("Enter the sanction letter or order reference.");
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest("Enter a valid sanction date.");
    const row = await queryOne<{ head: unknown }>(
      "select public.fn_add_fund_allocation($1, $2, $3, $4, $5::date, $6, $7) as head",
      [code, fy, amount, reference, date, String(b.remarks ?? "").slice(0, 1000), actor.code]
    );
    return ok({ head: row?.head }, 201);
  } catch (err) {
    return fail(err, "Could not record that allocation.");
  }
}
