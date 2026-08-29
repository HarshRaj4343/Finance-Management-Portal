import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { requireRole } from "@/server/session";
import { fail, ok, badRequest } from "@/server/http";
import { ROLES, normaliseRole } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL = /^[^@\s,]+@[^@\s,]+\.[a-zA-Z]{2,}$/;

/** PATCH — change a person's role, department, contact details or status. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const actor = await requireRole("Dean", "Finance Admin");
    const { code } = await params;
    const target = decodeURIComponent(code).trim();
    const b = (await req.json()) as Record<string, unknown>;

    const patch: Record<string, unknown> = {};

    if (b.employee_type !== undefined) {
      const role = normaliseRole(String(b.employee_type));
      if (!ROLES.includes(role)) return badRequest("That is not a role we recognise.");

      // architecture.jpeg puts one person in charge of who is what. This is
      // that gate: a Finance Admin can correct a name or an email, but only
      // the Dean of Finance decides which desk somebody sits at.
      if (actor.role !== "Dean") {
        return badRequest(
          "Only the Dean of Finance can change somebody's role. You can still update their name, email and department."
        );
      }

      // The Dean must not be able to demote themselves out of the only
      // page that can put anybody back.
      if (target === actor.code && role !== "Dean") {
        return badRequest(
          "You cannot remove your own Dean access. Ask another Dean to do it."
        );
      }
      patch.employee_type = role;
    }

    if (b.employee_name !== undefined) {
      const name = String(b.employee_name).trim();
      if (!name) return badRequest("A name is required.");
      patch.employee_name = name;
    }

    if (b.email !== undefined) {
      const email = String(b.email).trim().toLowerCase();
      if (!EMAIL.test(email)) return badRequest(`"${email}" is not a valid email address.`);
      patch.email = email;
    }

    if (b.department !== undefined) patch.department = String(b.department).trim();

    if (b.is_active !== undefined) {
      const active = Boolean(b.is_active);
      if (target === actor.code && !active) {
        return badRequest("You cannot deactivate your own account.");
      }
      patch.is_active = active;
    }

    if (Object.keys(patch).length === 0) return badRequest("Nothing to change.");

    const { data, error } = await db()
      .from("employees")
      .update(patch)
      .eq("employee_code", target)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return badRequest(`No employee with the code "${target}".`);

    console.log(`[admin] ${actor.code} updated ${target}:`, Object.keys(patch).join(", "));
    return ok({ employee: data });
  } catch (err) {
    return fail(err, "Could not save that change.");
  }
}

/**
 * DELETE — deactivate.
 *
 * Deliberately not a real delete. Bills, register entries and the event
 * log all name the person who filed or approved them; removing the row
 * would orphan records that are supposed to be permanent. Deactivating
 * stops them signing in and hides them from the pickers, which is what
 * "remove this person" actually means here.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const actor = await requireRole("Dean", "Finance Admin");
    const { code } = await params;
    const target = decodeURIComponent(code).trim();

    if (target === actor.code) {
      return badRequest("You cannot deactivate your own account.");
    }

    const { data, error } = await db()
      .from("employees")
      .update({ is_active: false })
      .eq("employee_code", target)
      .select("employee_code, employee_name, is_active")
      .maybeSingle();
    if (error) throw error;
    if (!data) return badRequest(`No employee with the code "${target}".`);

    const { count } = await db()
      .from("bills")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", target)
      .not("status", "in", '("Accepted","Rejected")');

    return ok({
      employee: data,
      note:
        count && count > 0
          ? `${data.employee_name} has been deactivated. ${count} of their bills are still in the workflow and will carry on.`
          : `${data.employee_name} has been deactivated.`,
    });
  } catch (err) {
    return fail(err, "Could not deactivate that person.");
  }
}
