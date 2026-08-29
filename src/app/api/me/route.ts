import { NextResponse } from "next/server";
import { db } from "@/server/db";
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

    const { data: pda } = await db()
      .from("pda_balances")
      .select("allocated, balance, committed, spent, updated_at")
      .eq("employee_id", actor.code)
      .maybeSingle();

    return ok({
      signedIn: true,
      ...actor,
      home: homeFor(actor.role),
      pda: pda ?? null,
    });
  } catch (err) {
    return fail(err, "Could not load your profile.");
  }
}
