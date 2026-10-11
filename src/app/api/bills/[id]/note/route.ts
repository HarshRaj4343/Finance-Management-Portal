import { NextRequest } from "next/server";
import { queryOne } from "@/server/db";
import { requireActor } from "@/server/session";
import { fail, ok, badRequest } from "@/server/http";
import { isUuid } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/bills/:id/note — acknowledge a rejected bill.
 *
 * "Noting" a bill clears it from the filing desk's list. It moves no
 * money.
 *
 * It used to: the old handler added the bill's value back to the PDA by
 * hand, because a rejection left the money debited. fn_bill_action now
 * releases the reservation at the moment of rejection, so doing it here as
 * well would credit the same amount twice.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireActor();
    const { id } = await params;

    if (!isUuid(id)) return badRequest("No such bill.");
    const row = await queryOne<{ bill: unknown }>(
      "select public.fn_note_bill($1::uuid, $2::jsonb) as bill", [id, JSON.stringify(actor)]
    );
    return ok({ bill: row?.bill });
  } catch (err) {
    return fail(err, "Could not note that bill.");
  }
}
