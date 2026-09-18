import { NextResponse } from "next/server";
import { queryOne } from "@/server/db";
import { currentActor } from "@/server/session";
import { fail, ok } from "@/server/http";
import { homeFor } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Everything a page needs about the person looking at it. */
export async function GET() {
  try {
    const actor = await currentActor();
    if (!actor) return NextResponse.json({ signedIn: false }, { status: 200 });

    const pda = await queryOne(
      `select allocated, balance, committed, spent, updated_at
         from public.pda_balances where employee_id = $1`,
      [actor.code]
    );

    return ok({
      signedIn: true,
      ...actor,
      home: homeFor(actor.role),
      pda,
    });
  } catch (err) {
    return fail(err, "Could not load your profile.");
  }
}
