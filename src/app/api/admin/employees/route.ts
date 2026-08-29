import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { requireRole } from "@/server/session";
import { fail, ok, badRequest } from "@/server/http";
import { ROLES, normaliseRole } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Dean of Finance's desk.
 *
 * architecture.jpeg: "Check Employee Type" / "No Employee Type Matched".
 * This is the only place a person's role is decided. Everything else in
 * the portal reads it.
 */

const EMAIL = /^[^@\s,]+@[^@\s,]+\.[a-zA-Z]{2,}$/;

/** GET /api/admin/employees — everyone, with their PDA position. */
export async function GET(req: NextRequest) {
  try {
    // Finance Admin keeps the directory it has always had; only the
    // Dean may decide what role anybody holds (see PATCH).
    await requireRole("Dean", "Finance Admin");
    const p = req.nextUrl.searchParams;

    let q = db()
      .from("employees")
      .select("*", { count: "exact" })
      .order("employee_type")
      .order("employee_code");

    if (p.get("role")) q = q.eq("employee_type", p.get("role"));
    if (p.get("department")) q = q.eq("department", p.get("department"));
    if (p.get("active") === "true") q = q.eq("is_active", true);
    if (p.get("active") === "false") q = q.eq("is_active", false);

    const text = p.get("q")?.trim();
    if (text) {
      const like = `%${text.replace(/[%,()]/g, "")}%`;
      q = q.or(
        [`employee_code.ilike.${like}`, `employee_name.ilike.${like}`, `email.ilike.${like}`].join(",")
      );
    }

    const { data, error, count } = await q;
    if (error) throw error;

    // Attach each person's PDA position in one extra query rather than
    // one per row.
    const codes = (data ?? []).map((e) => e.employee_code);
    const { data: pdas } = await db()
      .from("pda_balances")
      .select("employee_id, allocated, balance, committed, spent, updated_at")
      .in("employee_id", codes.length ? codes : ["__none__"]);

    const byCode = new Map((pdas ?? []).map((p) => [p.employee_id, p]));

    return ok({
      employees: (data ?? []).map((e) => ({ ...e, pda: byCode.get(e.employee_code) ?? null })),
      total: count ?? 0,
      roles: ROLES,
    });
  } catch (err) {
    return fail(err, "Could not load the employee list.");
  }
}

/**
 * POST /api/admin/employees — add somebody who has not logged in yet.
 *
 * Useful for provisioning an auditor before their first sign-in, so they
 * do not land on the plain user page and wonder why.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole("Dean", "Finance Admin");
    const b = (await req.json()) as Record<string, string | number | boolean>;

    const code = String(b.employee_code ?? "").trim();
    const name = String(b.employee_name ?? "").trim();
    const email = String(b.email ?? "").trim().toLowerCase();
    const department = String(b.department ?? "").trim();
    // Adding a person is one thing; deciding they are an auditor is
    // another. Anyone but the Dean adds them as a plain user.
    const requested = normaliseRole(String(b.employee_type ?? "User"));
    const role = actor.role === "Dean" ? requested : "User";

    if (!code) return badRequest("An employee code is required.");
    if (!name) return badRequest("A name is required.");
    if (!EMAIL.test(email)) return badRequest(`"${email}" is not a valid email address.`);
    if (!department) return badRequest("Choose a department.");

    const { data, error } = await db()
      .from("employees")
      .insert({
        employee_code: code,
        employee_name: name,
        email,
        department,
        employee_type: role,
        is_active: true,
      })
      .select()
      .single();
    if (error) throw error;

    // Open a PDA account at the same time if an allocation was given.
    const allocated = Number(b.allocated ?? 0);
    if (allocated > 0) {
      const { error: pdaErr } = await db().from("pda_balances").insert({
        employee_id: code,
        email,
        department,
        allocated,
        balance: allocated,
      });
      if (pdaErr) throw pdaErr;
    }

    console.log(`[admin] ${actor.code} added ${code} as ${role}`);
    return ok(
      {
        employee: data,
        note:
          requested !== role
            ? `${name} was added as a plain user. Only the Dean of Finance can assign the ${requested} role.`
            : null,
      },
      201
    );
  } catch (err) {
    return fail(err, "Could not add that person.");
  }
}
