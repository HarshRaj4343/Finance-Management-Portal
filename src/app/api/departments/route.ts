import { query } from "@/server/db";
import { fail, ok } from "@/server/http";

export const runtime = "nodejs";
// Not prerendered: the build (a Docker image, say) has no database to read
// from, and a failed read would be baked in as the static response.
export const dynamic = "force-dynamic";

/**
 * The department list, read from the database.
 *
 * finance-admin/page.tsx used to carry its own hardcoded copy of all 77
 * departments. Two lists that must agree is one list too many.
 */
export async function GET() {
  try {
    const departments = await query(
      "select name, code from public.departments where is_active order by name::text"
    );
    return ok({ departments });
  } catch (err) {
    return fail(err, "Could not load the department list.");
  }
}
