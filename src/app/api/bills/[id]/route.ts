import { NextRequest } from "next/server";
import { query, queryOne } from "@/server/db";
import { requireActor } from "@/server/session";
import { fail, ok } from "@/server/http";
import { canSeeAllBills, plannedRoute } from "@/lib/roles";
import { isUuid } from "@/lib/utils";

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

    const [events, register, applicant] = await Promise.all([
      query("select * from public.bill_approvals where bill_id = $1 order by seq", [id]),
      queryOne("select * from public.purchase_register where bill_id = $1", [id]),
      queryOne(
        `select employee_code, employee_name, email, department
           from public.employees where employee_code = $1`,
        [bill.employee_id]
      ),
    ]);

    return ok({
      bill,
      events,
      register,
      applicant,
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
 * transaction, and puts the bill back into the queue at whichever desk is
 * holding it. It refuses to touch a bill that has already been decided.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const body = (await req.json()) as Record<string, unknown>;

    const bill = isUuid(id)
      ? await queryOne<{ employee_id: string }>(
          "select employee_id from public.bills where id = $1",
          [id]
        )
      : null;
    if (!bill) return ok({ error: "No such bill." }, 404);

    if (!canSeeAllBills(actor.role) && bill.employee_id !== actor.code) {
      return ok({ error: "That bill belongs to somebody else." }, 403);
    }

    const row = await queryOne<{ bill: unknown }>(
      "select public.fn_amend_bill($1::uuid, $2::jsonb, $3::jsonb) as bill",
      [
        id,
        JSON.stringify(body),
        JSON.stringify({ code: actor.code, name: actor.name, role: actor.role }),
      ]
    );

    return ok({ bill: row?.bill });
  } catch (err) {
    return fail(err, "Could not save those corrections.");
  }
}
