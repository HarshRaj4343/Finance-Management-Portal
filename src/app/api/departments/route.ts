import { db } from "@/server/db";
import { fail, ok } from "@/server/http";

export const runtime = "nodejs";
export const revalidate = 3600;

/**
 * The department list, read from the database.
 *
 * finance-admin/page.tsx used to carry its own hardcoded copy of all 77
 * departments. Two lists that must agree is one list too many.
 */
export async function GET() {
  try {
    const { data, error } = await db()
      .from("departments")
      .select("name, code")
      .eq("is_active", true)
      .order("name");
    if (error) throw error;
    return ok({ departments: data ?? [] });
  } catch (err) {
    return fail(err, "Could not load the department list.");
  }
}
