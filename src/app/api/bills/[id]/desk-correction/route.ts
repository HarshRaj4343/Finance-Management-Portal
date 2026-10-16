import { NextRequest } from "next/server";
import { queryOne } from "@/server/db";
import { requireApprover } from "@/server/session";
import { fail, ok } from "@/server/http";
import { isUuid } from "@/lib/utils";
import { billPayload } from "@/server/bill-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/bills/:id/desk-correction   { form_data, expected_revision }
 *
 * The desk a bill was sent back to corrects it (0010_send_back.sql). The
 * form is validated exactly as a filer's correction; fn_desk_amend_bill
 * checks that the bill is at this person's desk because it was sent back
 * there, moves the reservation with the amount and fund, and keeps the
 * bill at the desk for its decision. Earlier desks' approvals stand.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireApprover();
    const { id } = await params;
    const input = (await req.json()) as Record<string, unknown>;
    const body = billPayload(input.form_data);

    const bill = isUuid(id)
      ? await queryOne<{ employee_id: string }>("select employee_id from public.bills where id = $1", [id])
      : null;
    if (!bill) return ok({ error: "No such bill." }, 404);
    if (body.employee_id.toUpperCase() !== bill.employee_id.toUpperCase()) return ok({ error: "The applicant cannot be changed." }, 400);

    const row = await queryOne<{ bill: unknown }>(
      "select public.fn_desk_amend_bill($1::uuid, $2::jsonb, $3::jsonb) as bill",
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
