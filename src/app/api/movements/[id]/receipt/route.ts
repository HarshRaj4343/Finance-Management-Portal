import { NextRequest } from "next/server";
import { queryOne } from "@/server/db";
import { HttpError, requireActor } from "@/server/session";
import { fail, ok, badRequest } from "@/server/http";
import { canOpenMovementRegister } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/movements/:id/receipt   { received: true | false }
 *
 * Marks one inward / outward register entry Received or Not received.
 * fn_mark_movement_received (0009) allows the entry's own desk and the
 * Dean, and keeps every change in change_log. The entry itself is never
 * edited.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireActor();
    if (!canOpenMovementRegister(actor.role)) {
      throw new HttpError(403, "Only the Dean, Finance Admin, Audit and Store and Purchase can mark register entries.");
    }
    const { id } = await params;
    if (!/^\d{1,18}$/.test(id)) return badRequest("No such register entry.");
    const body = (await req.json().catch(() => ({}))) as { received?: unknown };
    if (typeof body.received !== "boolean") return badRequest("Mark the entry received or not received.");

    const row = await queryOne<{ receipt: unknown }>(
      "select public.fn_mark_movement_received($1::bigint, $2, $3) as receipt", [id, body.received, actor.code]
    );
    return ok({ receipt: row?.receipt });
  } catch (err) {
    return fail(err, "Could not mark that entry.");
  }
}
