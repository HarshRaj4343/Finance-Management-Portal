import { redirect } from "next/navigation";
import { currentActor } from "@/server/session";
import { homeFor } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * The root path is a signpost, nothing else: signed out goes to the login
 * portal, signed in goes to whichever desk the person's role belongs to.
 */
export default async function Page() {
  const actor = await currentActor();
  redirect(actor ? homeFor(actor.role) : "/login");
}
