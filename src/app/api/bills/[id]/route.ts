import { NextRequest } from "next/server";
import { query, queryOne } from "@/server/db";
import { requireActor } from "@/server/session";
import { fail, ok } from "@/server/http";
import { canSeeAllBills, plannedRoute } from "@/lib/roles";
import { isUuid } from "@/lib/utils";
import { assertBillWriter, billPayload } from "@/server/bill-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/bills/:id
 *
 * One bill, with its full history and its register entry. This is what the
 * QR code leads to and what the applicant sees on their own page:
 * everything that happened, when, and at whose desk.
 *
 * Access: the applicant, or anybody holding a workflow role. The portal is
 * for internal use, so a scanned QR still asks the reader to sign in first.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireActor();
    const { id } = await params;

    if (!isUuid(id)) return ok({ error: "No such bill." }, 404);

    const bill = await queryOne("select * from public.bills where id = $1", [id]);
    if (!bill) return ok({ error: "No such bill." }, 404);

    if (!canSeeAllBills(actor.role) && bill.employee_id !== actor.code) {
      return ok({ error: "This bill belongs to somebody else." }, 403);
    }

    const [events, register, applicant, revisions] = await Promise.all([
      query("select * from public.bill_approvals where bill_id = $1 order by seq", [id]),
      queryOne("select * from public.purchase_register where bill_id = $1", [id]),
      queryOne(
        `select employee_code, employee_name, email, department
           from public.employees where employee_code = $1`,
        [bill.employee_id]
      ),
      query("select actor_code, old_data, new_data, recorded_at from public.change_log where entity = 'bills' and entity_id = $1 order by id", [id]),
    ]);

    return ok({
      bill,
      events,
      register,
      applicant,
      revisions,
      // The desks this bill was always going to visit, so the timeline can
      // show what is still ahead of it as well as what is behind.
      route: plannedRoute(bill.item_category, Number(bill.po_value)),
    });
  } catch (err) {
    return fail(err, "Could not load that bill.");
  }
}

/**
 * PATCH /api/bills/:id — correct a bill that came back on hold.
 *
 * fn_amend_bill moves the PDA reservation with the amount, in the same
 * transaction, invalidates previous approvals, and restarts the required
 * route. It rejects non-held bills and stale correction versions.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const input = (await req.json()) as Record<string, unknown>;
    const body = billPayload(input.form_data);

    const bill = isUuid(id)
      ? await queryOne<{ employee_id: string; employee_department: string | null }>(
          "select employee_id, employee_department from public.bills where id = $1",
          [id]
        )
      : null;
    if (!bill) return ok({ error: "No such bill." }, 404);

    assertBillWriter(actor, bill.employee_id, bill.employee_department, true);
    if (body.employee_id.toUpperCase() !== bill.employee_id.toUpperCase()) return ok({ error: "The applicant cannot be changed." }, 400);

    const row = await queryOne<{ bill: unknown }>(
      "select public.fn_amend_bill($1::uuid, $2::jsonb, $3::jsonb) as bill",
      [
        id,
        JSON.stringify({ ...body, employee_id: bill.employee_id, expected_revision: input.expected_revision }),
        JSON.stringify({ code: actor.code, name: actor.name, role: actor.role }),
      ]
    );

    return ok({ bill: row?.bill });
  } catch (err) {
    return fail(err, "Could not save those corrections.");
  }
}
