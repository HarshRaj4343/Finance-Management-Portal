import { NextRequest } from "next/server";
import { queryOne } from "@/server/db";
import { requireActor } from "@/server/session";
import { fail, ok, badRequest } from "@/server/http";
import { isUuid } from "@/lib/utils";
import { assertBillWriter } from "@/server/bill-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/bills/:id/edit-window   { pause: true | false }
 *
 * Stops the bill's edit window while its filer has the correction form
 * open (pause: true, sent again every minute to renew the lease), and
 * restarts it when the form closes (pause: false). fn_edit_window_pause
 * in 0009 holds the clock; a bill with no running window is returned as is.
 *
 * The body is read as text so a page being closed can resume the clock
 * with navigator.sendBeacon.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    if (!isUuid(id)) return badRequest("No such bill.");

    let body: { pause?: unknown };
    try { body = JSON.parse((await req.text()) || "{}"); } catch { return badRequest("Invalid request."); }
    if (typeof body.pause !== "boolean") return badRequest("Say whether to pause or resume the edit window.");

    const owner = await queryOne<{ employee_id: string; employee_department: string | null }>(
      "select employee_id, employee_department::text from public.bills where id = $1", [id]
    );
    if (!owner) return badRequest("No such bill.");
    assertBillWriter(actor, owner.employee_id, owner.employee_department, true);

    const row = await queryOne<{ bill: unknown }>(
      "select public.fn_edit_window_pause($1::uuid, $2, $3) as bill", [id, actor.code, body.pause]
    );
    return ok({ bill: row?.bill });
  } catch (err) {
    return fail(err, "Could not update the edit window.");
  }
}
