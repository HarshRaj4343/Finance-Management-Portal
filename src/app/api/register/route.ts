import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { requireActor } from "@/server/session";
import { fail, ok } from "@/server/http";
import { canSeeAllBills } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/register  --  the departmental purchase register.
 *
 * The official record of what was actually bought: one row per finally
 * approved purchase, with the running serial number it was entered under.
 * Append-only in the database; there is deliberately no write endpoint.
 * Entries are cut by fn_bill_action at the moment of final approval.
 *
 *   ?department= &fy= &q= &from= &to= &limit= &offset=
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireActor();
    const p = req.nextUrl.searchParams;

    const limit = Math.min(Number(p.get("limit") ?? 100) || 100, 500);
    const offset = Math.max(Number(p.get("offset") ?? 0) || 0, 0);

    let q = db()
      .from("purchase_register")
      .select("*", { count: "exact" })
      .order("recorded_at", { ascending: false })
      .range(offset, offset + limit - 1);

    // A plain user sees their own purchases in the register, nobody else's.
    if (!canSeeAllBills(actor.role)) {
      q = q.eq("employee_code", actor.code);
    }

    if (p.get("department")) q = q.eq("department", p.get("department"));
    if (p.get("fy")) q = q.eq("financial_year", p.get("fy"));
    if (p.get("from")) q = q.gte("entry_date", p.get("from"));
    if (p.get("to")) q = q.lte("entry_date", p.get("to"));

    const text = p.get("q")?.trim();
    if (text) {
      const like = `%${text.replace(/[%,()]/g, "")}%`;
      q = q.or(
        [
          `serial_no.ilike.${like}`,
          `item_description.ilike.${like}`,
          `supplier_name.ilike.${like}`,
          `employee_name.ilike.${like}`,
          `employee_code.ilike.${like}`,
          `bill_number.ilike.${like}`,
        ].join(",")
      );
    }

    const { data, error, count } = await q;
    if (error) throw error;

    // Totals for the filtered set, computed in the database rather than by
    // adding up one page of rows in the browser.
    const { data: totals } = await db().rpc("fn_register_totals", {
      p_department: p.get("department"),
      p_fy: p.get("fy"),
    });

    return ok({
      entries: data ?? [],
      total: count ?? 0,
      limit,
      offset,
      totals: totals ?? null,
    });
  } catch (err) {
    return fail(err, "Could not load the purchase register.");
  }
}
