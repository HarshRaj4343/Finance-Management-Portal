import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { requireActor } from "@/server/session";
import { fail, ok, badRequest } from "@/server/http";
import { canSeeAllBills } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BILL_COLUMNS = `
  id, bill_number, employee_id, employee_name, employee_department,
  po_details, po_value, supplier_name, supplier_address,
  item_category, item_description, qty, qty_issued, bill_details,
  indenter_name, source_of_fund, stock_entry, location,
  has_bank_guarantee, bank_guarantee_details, bank_guarantee_amount,
  date_of_installation, date_of_delivery,
  status, snp, audit, finance_admin, noted,
  remarks, remarks1, remarks2, remarks3, remarks4,
  decided_at, created_at, updated_at
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
 *   ?limit= &offset=      paging, default 100
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireActor();
    const p = req.nextUrl.searchParams;

    const limit = Math.min(Number(p.get("limit") ?? 100) || 100, 500);
    const offset = Math.max(Number(p.get("offset") ?? 0) || 0, 0);

    let q = db()
      .from("bills")
      .select(BILL_COLUMNS, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (!canSeeAllBills(actor.role)) {
      // Not negotiable, and applied before anything from the query string.
      q = q.eq("employee_id", actor.code);
    } else if (p.get("employee")) {
      q = q.eq("employee_id", p.get("employee")!.trim());
    }

    if (p.get("stage")) q = q.eq("status", p.get("stage"));
    if (p.get("status")) q = q.eq("status", p.get("status"));
    if (p.get("category")) q = q.eq("item_category", p.get("category"));
    if (p.get("department")) q = q.eq("employee_department", p.get("department"));

    const text = p.get("q")?.trim();
    if (text) {
      const like = `%${text.replace(/[%,()]/g, "")}%`;
      q = q.or(
        [
          `item_description.ilike.${like}`,
          `supplier_name.ilike.${like}`,
          `bill_number.ilike.${like}`,
          `po_details.ilike.${like}`,
          `employee_name.ilike.${like}`,
          `employee_id.ilike.${like}`,
        ].join(",")
      );
    }

    const { data, error, count } = await q;
    if (error) throw error;

    return ok({ bills: data ?? [], total: count ?? 0, limit, offset });
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
    const body = (await req.json()) as Record<string, unknown>;
    if (!canSeeAllBills(actor.role)) {
      body.employee_id = actor.code;
    }

    if (!body.employee_id) return badRequest("An employee ID is required.");
    if (!body.item_category) return badRequest("Choose an item category.");
    const amount = Number(body.po_value);
    if (!Number.isFinite(amount) || amount <= 0) {
      return badRequest("Enter a bill amount greater than zero.");
    }

    const { data, error } = await db().rpc("fn_submit_bill", {
      p_payload: { ...body, po_value: amount },
      p_actor: { code: actor.code, name: actor.name, role: actor.role },
    });
    if (error) throw error;

    return ok({ bill: data }, 201);
  } catch (err) {
    return fail(err, "Could not file the bill.");
  }
}
