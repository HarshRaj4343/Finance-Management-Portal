import "server-only";
import { NextResponse } from "next/server";

/**
 * Turns whatever the database threw into something a person can read.
 *
 * The workflow functions raise their messages with errcode P0001 and
 * write them for the person on the other side of the screen, so those
 * pass through as-is with a 400. Anything else is a bug on our side: it
 * is logged in full on the server and reported as a generic 500, because
 * a raw Postgres error string is neither useful nor safe to show.
 */
export function fail(err: unknown, fallback = "Something went wrong."): NextResponse {
  const e = err as { code?: string; message?: string; details?: string; status?: number };

  // An HttpError thrown by a session guard already knows its status code.
  if (typeof e?.status === "number" && e.status >= 400 && e.status < 500 && e.message) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }

  // P0001 = raise_exception, i.e. a rule we wrote deliberately.
  if (e?.code === "P0001" && e.message) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  // Constraint violations we can phrase better than Postgres does.
  if (e?.code === "23505") {
    return NextResponse.json(
      { error: "That record already exists." },
      { status: 409 }
    );
  }
  if (e?.code === "23514" && /pda_conserved|pda_non_negative/.test(e.message ?? "")) {
    return NextResponse.json(
      { error: "That change would leave the PDA account inconsistent. Nothing was saved." },
      { status: 400 }
    );
  }
  if (e?.code === "23503") {
    return NextResponse.json(
      { error: "That refers to a record which does not exist." },
      { status: 400 }
    );
  }

  console.error("[api]", e?.code ?? "", e?.message ?? err, e?.details ?? "");
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function denied(message = "You are not allowed to do that."): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function unauthenticated(): NextResponse {
  return NextResponse.json({ error: "Please sign in." }, { status: 401 });
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}
