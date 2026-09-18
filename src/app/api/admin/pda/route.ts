import { NextRequest } from "next/server";
import { query, queryOne, Params, whereClause, likePattern } from "@/server/db";
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

    const params = new Params();
    const where: string[] = [];

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
    await requireRole("PDA Manager", "Dean");
    const b = (await req.json()) as Record<string, unknown>;

    const code = String(b.employee_id ?? "").trim();
    const allocated = Number(b.allocated ?? 0);
    if (!code) return badRequest("An employee code is required.");
    if (!Number.isFinite(allocated) || allocated < 0) {
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

    const account = await queryOne(
      `insert into public.pda_balances (employee_id, email, department, allocated, balance)
       values ($1, $2, $3, $4, $4)
       returning *`,
      [emp.employee_code, emp.email, emp.department, allocated]
    );

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

    let target: number;
    if (b.top_up !== undefined) {
      const add = Number(b.top_up);
      if (!Number.isFinite(add)) return badRequest("Enter a valid amount.");
      const cur = await queryOne<{ allocated: number }>(
        "select allocated from public.pda_balances where employee_id = $1",
        [code]
      );
      if (!cur) return badRequest(`No PDA account for "${code}".`);
      target = Number(cur.allocated) + add;
    } else {
      target = Number(b.allocated);
      if (!Number.isFinite(target) || target < 0) {
        return badRequest("Enter an allocation of zero or more.");
      }
    }

    const row = await queryOne<{ account: unknown }>(
      "select public.fn_set_pda_allocation($1, $2, $3) as account",
      [code, target, actor.code]
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
    await requireRole("PDA Manager", "Dean");
    const code = req.nextUrl.searchParams.get("employee_id")?.trim();
    if (!code) return badRequest("Which account? Pass employee_id.");

    const acc = await queryOne<{ committed: number; spent: number }>(
      "select committed, spent from public.pda_balances where employee_id = $1",
      [code]
    );
    if (!acc) return badRequest(`No PDA account for "${code}".`);

    if (Number(acc.committed) > 0 || Number(acc.spent) > 0) {
      return badRequest(
        `This account cannot be closed: ₹${Number(acc.committed).toLocaleString("en-IN")} is committed to bills still in progress and ₹${Number(acc.spent).toLocaleString("en-IN")} has been spent. Set the allocation to zero instead.`
      );
    }

    await query("delete from public.pda_balances where employee_id = $1", [code]);

    return ok({ closed: code });
  } catch (err) {
    return fail(err, "Could not close that PDA account.");
  }
}
