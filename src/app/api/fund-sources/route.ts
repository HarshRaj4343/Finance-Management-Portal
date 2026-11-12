import { NextRequest } from "next/server";
import { actorQueryOne, query } from "@/server/db";
import { requireActor, requireRole } from "@/server/session";
import { fail, ok, badRequest } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORIES = ["Consumables", "Minor", "Major"];

/**
 * GET /api/fund-sources
 *
 * The sources of fund a bill may be charged to. Anyone signed in reads the
 * active ones: the bill form builds its dropdown from them. The Dean also
 * gets the switched-off ones (?all=1), with this year's sanctioned money, so
 * the Source of Funds page can manage them.
 */
export async function GET(req: NextRequest) {
  try {
    const all = req.nextUrl.searchParams.get("all") === "1";
    if (all) await requireRole("Dean"); else await requireActor();
    const sources = await query(
      `select s.code, s.description, s.group_name, s.kind, s.categories, s.is_builtin, s.is_active,
              s.approved_by, s.approved_at,
              h.financial_year as head_year, h.allocated, h.balance, h.committed, h.spent
         from public.fund_sources s
         left join public.fund_heads h on h.code = s.code and h.financial_year = public.fn_financial_year()
        ${all ? "" : "where s.is_active"}
        order by s.is_builtin desc, s.group_name, s.code`
    );
    return ok({ sources });
  } catch (err) {
    return fail(err, "Could not load the sources of fund.");
  }
}

/**
 * POST /api/fund-sources  { code, description, group?, categories? }
 *
 * The Dean approves a new source of fund. It is a budget head with no
 * money yet: sanction some on its register before a bill can use it.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole("Dean");
    const b = (await req.json()) as Record<string, unknown>;
    const categories = Array.isArray(b.categories) ? b.categories.map(String) : CATEGORIES;
    if (!categories.length || categories.some((c) => !CATEGORIES.includes(c))) return badRequest("Choose which kinds of purchase this source may pay for.");
    const row = await actorQueryOne<{ source: unknown }>(actor.code,
      "select public.fn_add_fund_source($1, $2, $3, $4::text[], $5) as source",
      [String(b.code ?? ""), String(b.description ?? ""), String(b.group ?? ""), categories, actor.code]);
    return ok({ source: row?.source }, 201);
  } catch (err) {
    return fail(err, "Could not approve that source of fund.");
  }
}

/** PATCH /api/fund-sources  { code, is_active } -- switch a source on or off. Bills already charged to it are unaffected. */
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireRole("Dean");
    const b = (await req.json()) as Record<string, unknown>;
    if (typeof b.is_active !== "boolean") return badRequest("Say whether the source is active.");
    const row = await actorQueryOne<{ source: unknown }>(actor.code,
      "select public.fn_set_fund_source_active($1, $2, $3) as source", [String(b.code ?? ""), b.is_active, actor.code]);
    return ok({ source: row?.source });
  } catch (err) {
    return fail(err, "Could not change that source of fund.");
  }
}
