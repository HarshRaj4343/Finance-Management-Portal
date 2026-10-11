import { NextRequest } from "next/server";
import { query, queryOne, actorQueryOne, Params, whereClause, likePattern } from "@/server/db";
import { requireRole } from "@/server/session";
import { fail, ok, badRequest } from "@/server/http";
import { isMoney } from "@/lib/security";

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

    const params = new Params();
    const where: string[] = ["pda.is_active"];

    if (p.get("department")) where.push(`pda.department::text = ${params.add(p.get("department"))}`);

    const text = p.get("q")?.trim();
    if (text) {
      const like = params.add(likePattern(text));
      where.push(`(pda.employee_id ilike ${like} or pda.email ilike ${like})`);
    }

    // Names live on employees, not here.
    const accounts = await query(
      `select pda.*, e.employee_name, e.employee_type
         from public.pda_balances pda
         left join public.employees e on e.employee_code = pda.employee_id
         ${whereClause(where)}
        order by pda.updated_at desc`,
      params.values
    );

    return ok({ accounts, total: accounts.length });
  } catch (err) {
    return fail(err, "Could not load PDA accounts.");
  }
}

/** POST — open a PDA account for somebody who does not have one. */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole("PDA Manager", "Dean");
    const b = (await req.json()) as Record<string, unknown>;

    const code = String(b.employee_id ?? "").trim();
    const allocated = Number(b.allocated ?? 0);
    if (!code) return badRequest("An employee code is required.");
    if (!isMoney(allocated)) {
      return badRequest("Enter an allocation of zero or more.");
    }

    const emp = await queryOne(
      "select employee_code, email, department from public.employees where employee_code = $1",
      [code]
    );
    if (!emp) {
      return badRequest(
        `There is no employee with the code "${code}". Add them from the employees tab first.`
      );
    }

    const account = await actorQueryOne(actor.code,
      `insert into public.pda_balances (employee_id, email, department, allocated, balance)
       values ($1, $2, $3, $4, $4)
       on conflict (employee_id) do update set is_active = true, allocated = excluded.allocated,
         email = excluded.email, department = excluded.department,
         balance = excluded.allocated, updated_at = now()
         where not pda_balances.is_active and pda_balances.committed = 0 and pda_balances.spent = 0
       returning *`,
      [emp.employee_code, emp.email, emp.department, allocated]
    );

    if (!account) return badRequest("This employee already has an active PDA account.");
    return ok({ account }, 201);
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

    const topUp = b.top_up !== undefined;
    const amount = Number(topUp ? b.top_up : b.allocated);
    if (!isMoney(amount) || (topUp && amount === 0)) return badRequest("Enter a finite valid amount with at most two decimal places.");
    const row = await queryOne<{ account: unknown }>(
      topUp ? "select public.fn_top_up_pda($1, $2, $3) as account" : "select public.fn_set_pda_allocation($1, $2, $3) as account",
      [code, amount, actor.code]
    );

    return ok({ account: row?.account });
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
    const actor = await requireRole("PDA Manager", "Dean");
    const code = req.nextUrl.searchParams.get("employee_id")?.trim();
    if (!code) return badRequest("Which account? Pass employee_id.");

    await query("select public.fn_close_pda($1, $2)", [code, actor.code]);

    return ok({ closed: code });
  } catch (err) {
    return fail(err, "Could not close that PDA account.");
  }
}
