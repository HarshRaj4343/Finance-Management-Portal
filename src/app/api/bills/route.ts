import { NextRequest } from "next/server";
import { query, queryOne, Params, whereClause, likePattern } from "@/server/db";
import { requireActor } from "@/server/session";
import { fail, ok, badRequest } from "@/server/http";
import { canSeeAllBills, isApprover } from "@/lib/roles";
import { findEmployee } from "@/server/employee";
import { assertBillWriter, billPayload } from "@/server/bill-validation";
import { pagination } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BILL_COLUMNS = `
  id, revision, created_by, invoice_no, invoice_date, form_data, bill_number, employee_id, employee_name, employee_department,
  po_details, po_value, supplier_name, supplier_address,
  item_category, item_description, qty, qty_issued, bill_details,
  indenter_name, source_of_fund, stock_entry, location,
  has_bank_guarantee, bank_guarantee_details, bank_guarantee_amount,
  date_of_installation, date_of_delivery,
  status, snp, audit, finance_admin, noted,
  remarks, remarks1, remarks2, remarks3, remarks4,
  decided_at, created_at::text, updated_at::text, editable_until, funding_pool, funding_fy,
  greatest(
    (select max(a.created_at) from public.bill_approvals a
      where a.bill_id = bills.id and a.to_status = bills.status
        and a.from_status is distinct from a.to_status),
    editable_until
  ) as stage_entered_at
`;

/**
 * GET /api/bills
 *
 * Scoped by role, on the server. A plain user sees only their own bills,
 * whatever they put in the query string. The prototype let the browser ask
 * for everything and filtered in React, which is not a filter.
 *
 *   ?stage=Audit          bills sitting at one desk (approvers only)
 *   ?status=Accepted      by final state
 *   ?employee=E001        one person's bills (approvers only)
 *   ?q=pump               free text over item, supplier, bill number, PO
 *   ?from=2026-04-01 &to=  filed between these IST dates, inclusive
 *   ?limit= &offset=      paging, default 100
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireActor();
    const p = req.nextUrl.searchParams;

    const { limit, offset } = pagination(p);

    const params = new Params();
    const where: string[] = [];

    if (!canSeeAllBills(actor.role)) {
      // Not negotiable, and applied before anything from the query string.
      where.push(`employee_id = ${params.add(actor.code)}`);
    } else if (p.get("employee")) {
      where.push(`employee_id = ${params.add(p.get("employee")!.trim())}`);
    }

    // A freshly filed bill stays with its filer for the edit window; the
    // desks see it only afterwards. fn_bill_window_guard enforces the same.
    if (isApprover(actor.role)) {
      where.push("(editable_until is null or editable_until <= now())");
    }

    for (const [key, op] of [["from", ">="], ["to", "<="]] as const) {
      const day = p.get(key);
      if (!day) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) return badRequest("Dates must be YYYY-MM-DD.");
      where.push(`(created_at at time zone 'Asia/Kolkata')::date ${op} ${params.add(day)}::date`);
    }

    if (p.get("stage")) where.push(`status = ${params.add(p.get("stage"))}`);
    if (p.get("status")) where.push(`status = ${params.add(p.get("status"))}`);
    if (p.get("category")) where.push(`item_category = ${params.add(p.get("category"))}`);
    if (p.get("department")) {
      where.push(`employee_department::text = ${params.add(p.get("department"))}`);
    }

    const text = p.get("q")?.trim();
    if (text) {
      const like = params.add(likePattern(text));
      where.push(
        `(item_description ilike ${like} or supplier_name ilike ${like}
          or bill_number ilike ${like} or po_details ilike ${like}
          or employee_name ilike ${like} or employee_id ilike ${like})`
      );
    }

    if (p.get("cursor")) {
      const [date, id] = p.get("cursor")!.split("|");
      if (!date || Number.isNaN(Date.parse(date)) || !/^[0-9a-f-]{36}$/i.test(id ?? "")) return badRequest("Invalid page cursor.");
      where.push(`(created_at, id) < (${params.add(date)}::timestamptz, ${params.add(id)}::uuid)`);
    }

    const filter = whereClause(where);
    const filterValues = [...params.values];
    const page = `limit ${params.add(limit)} offset ${params.add(offset)}`;

    const [data, counted] = await Promise.all([
      query(
        `select ${BILL_COLUMNS} from public.bills ${filter}
         order by bills.created_at desc, bills.id desc ${page}`,
        params.values
      ),
      queryOne<{ total: number }>(
        `select count(*) as total from public.bills ${filter}`,
        filterValues
      ),
    ]);

    const last = data[data.length - 1];
    return ok({ bills: data, total: counted?.total ?? 0, limit, offset,
      nextCursor: data.length === limit && last ? `${last.created_at}|${last.id}` : null });
  } catch (err) {
    return fail(err, "Could not load bills.");
  }
}

/**
 * POST /api/bills  --  file a new bill.
 *
 * The whole thing happens inside fn_submit_bill: the balance check, the
 * insert, the reservation against the PDA and the first entries in the
 * event log, in one transaction. Previously the insert and the debit were
 * two separate calls from the browser, so a failure between them left a
 * bill that had not been paid for.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireActor();

    // A plain user cannot file a bill for somebody else.
    const input = (await req.json()) as Record<string, unknown>;
    const body = billPayload(input.form_data);

    if (!body.employee_id) return badRequest("An employee ID is required.");
    const employee = await findEmployee(String(body.employee_id));
    if (!employee?.is_active) return badRequest("No active employee has this ID. Check the employee ID or student enrolment number.");
    assertBillWriter(actor, employee.employee_code, employee.department);
    body.employee_id = employee.employee_code;
    body.employee_name = employee.employee_name;
    // Stock references are assigned by the database, never by the browser.
    if (!body.item_category) return badRequest("Choose an item category.");
    const amount = Number(body.po_value);
    if (!Number.isFinite(amount) || amount <= 0) {
      return badRequest("Enter a bill amount greater than zero.");
    }

    const row = await queryOne<{ bill: unknown }>(
      "select public.fn_submit_bill($1::jsonb, $2::jsonb) as bill",
      [
        JSON.stringify({ ...body, po_value: amount, submission_key: input.submission_key }),
        JSON.stringify({ code: actor.code, name: actor.name, role: actor.role }),
      ]
    );

    return ok({ bill: row?.bill }, 201);
  } catch (err) {
    return fail(err, "Could not file the bill.");
  }
}
