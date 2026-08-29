import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { requireRole } from "@/server/session";
import { fail, ok, badRequest } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PDA accounts.
 *
 * Held by the PDA Manager, and by the Dean who can do everything.
 *
 * A balance is never written directly. fn_set_pda_allocation moves only
 * the free part, and refuses to cut an allocation below what is already
 * committed to bills in flight or spent on approved ones -- which is what
 * kept the old "set the balance to whatever" behaviour from ever being
 * safe.
 */

/** GET /api/admin/pda — every account, with what is free and what is not. */
export async function GET(req: NextRequest) {
  try {
    await requireRole("PDA Manager", "Dean", "Finance Admin");
    const p = req.nextUrl.searchParams;

    let q = db()
      .from("pda_balances")
      .select("*", { count: "exact" })
      .order("updated_at", { ascending: false });

    if (p.get("department")) q = q.eq("department", p.get("department"));

    const text = p.get("q")?.trim();
    if (text) {
      const like = `%${text.replace(/[%,()]/g, "")}%`;
      q = q.or([`employee_id.ilike.${like}`, `email.ilike.${like}`].join(","));
    }

    const { data, error, count } = await q;
    if (error) throw error;

    // Names live on employees, not here.
    const codes = (data ?? []).map((r) => r.employee_id);
    const { data: people } = await db()
      .from("employees")
      .select("employee_code, employee_name, employee_type")
      .in("employee_code", codes.length ? codes : ["__none__"]);
    const byCode = new Map((people ?? []).map((e) => [e.employee_code, e]));

    return ok({
      accounts: (data ?? []).map((r) => ({
        ...r,
        employee_name: byCode.get(r.employee_id)?.employee_name ?? null,
        employee_type: byCode.get(r.employee_id)?.employee_type ?? null,
      })),
      total: count ?? 0,
    });
  } catch (err) {
    return fail(err, "Could not load PDA accounts.");
  }
}

/** POST — open a PDA account for somebody who does not have one. */
export async function POST(req: NextRequest) {
  try {
    await requireRole("PDA Manager", "Dean");
    const b = (await req.json()) as Record<string, unknown>;

    const code = String(b.employee_id ?? "").trim();
    const allocated = Number(b.allocated ?? 0);
    if (!code) return badRequest("An employee code is required.");
    if (!Number.isFinite(allocated) || allocated < 0) {
      return badRequest("Enter an allocation of zero or more.");
    }

    const { data: emp } = await db()
      .from("employees")
      .select("employee_code, email, department")
      .eq("employee_code", code)
      .maybeSingle();
    if (!emp) {
      return badRequest(
        `There is no employee with the code "${code}". Add them from the employees tab first.`
      );
    }

    const { data, error } = await db()
      .from("pda_balances")
      .insert({
        employee_id: emp.employee_code,
        email: emp.email,
        department: emp.department,
        allocated,
        balance: allocated,
      })
      .select()
      .single();
    if (error) throw error;

    return ok({ account: data }, 201);
  } catch (err) {
    return fail(err, "Could not open that PDA account.");
  }
}

/**
 * PATCH — set the allocation.
 *
 *   { employee_id, allocated }      set the total to this
 *   { employee_id, top_up }         add this to the total
 */
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireRole("PDA Manager", "Dean");
    const b = (await req.json()) as Record<string, unknown>;

    const code = String(b.employee_id ?? "").trim();
    if (!code) return badRequest("An employee code is required.");

    let target: number;
    if (b.top_up !== undefined) {
      const add = Number(b.top_up);
      if (!Number.isFinite(add)) return badRequest("Enter a valid amount.");
      const { data: cur } = await db()
        .from("pda_balances")
        .select("allocated")
        .eq("employee_id", code)
        .maybeSingle();
      if (!cur) return badRequest(`No PDA account for "${code}".`);
      target = Number(cur.allocated) + add;
    } else {
      target = Number(b.allocated);
      if (!Number.isFinite(target) || target < 0) {
        return badRequest("Enter an allocation of zero or more.");
      }
    }

    const { data, error } = await db().rpc("fn_set_pda_allocation", {
      p_employee_code: code,
      p_allocated: target,
      p_actor_code: actor.code,
    });
    if (error) throw error;

    return ok({ account: data });
  } catch (err) {
    return fail(err, "Could not update that PDA account.");
  }
}

/**
 * DELETE /api/admin/pda?employee_id=E001 — close a PDA account.
 *
 * Refused while any money is committed to bills in flight or has been
 * spent: those figures are referenced by the register and the event log,
 * and an account that has paid for something is part of the record.
 */
export async function DELETE(req: NextRequest) {
  try {
    await requireRole("PDA Manager", "Dean");
    const code = req.nextUrl.searchParams.get("employee_id")?.trim();
    if (!code) return badRequest("Which account? Pass employee_id.");

    const { data: acc } = await db()
      .from("pda_balances")
      .select("committed, spent")
      .eq("employee_id", code)
      .maybeSingle();
    if (!acc) return badRequest(`No PDA account for "${code}".`);

    if (Number(acc.committed) > 0 || Number(acc.spent) > 0) {
      return badRequest(
        `This account cannot be closed: ₹${Number(acc.committed).toLocaleString("en-IN")} is committed to bills still in progress and ₹${Number(acc.spent).toLocaleString("en-IN")} has been spent. Set the allocation to zero instead.`
      );
    }

    const { error } = await db().from("pda_balances").delete().eq("employee_id", code);
    if (error) throw error;

    return ok({ closed: code });
  } catch (err) {
    return fail(err, "Could not close that PDA account.");
  }
}
