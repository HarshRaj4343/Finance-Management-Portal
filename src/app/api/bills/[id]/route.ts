import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { requireActor } from "@/server/session";
import { fail, ok } from "@/server/http";
import { canSeeAllBills, plannedRoute } from "@/lib/roles";

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

    const { data: bill, error } = await db()
      .from("bills")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!bill) return ok({ error: "No such bill." }, 404);

    if (!canSeeAllBills(actor.role) && bill.employee_id !== actor.code) {
      return ok({ error: "This bill belongs to somebody else." }, 403);
    }

    const [{ data: events }, { data: register }, { data: applicant }] =
      await Promise.all([
        db()
          .from("bill_approvals")
          .select("*")
          .eq("bill_id", id)
          .order("seq", { ascending: true }),
        db()
          .from("purchase_register")
          .select("*")
          .eq("bill_id", id)
          .maybeSingle(),
        db()
          .from("employees")
          .select("employee_code, employee_name, email, department")
          .eq("employee_code", bill.employee_id)
          .maybeSingle(),
      ]);

    return ok({
      bill,
      events: events ?? [],
      register: register ?? null,
      applicant: applicant ?? null,
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

    const { data: bill } = await db()
      .from("bills")
      .select("employee_id")
      .eq("id", id)
      .maybeSingle();
    if (!bill) return ok({ error: "No such bill." }, 404);

    if (!canSeeAllBills(actor.role) && bill.employee_id !== actor.code) {
      return ok({ error: "That bill belongs to somebody else." }, 403);
    }

    const { data, error } = await db().rpc("fn_amend_bill", {
      p_bill_id: id,
      p_payload: body,
      p_actor: { code: actor.code, name: actor.name, role: actor.role },
    });
    if (error) throw error;

    return ok({ bill: data });
  } catch (err) {
    return fail(err, "Could not save those corrections.");
  }
}
