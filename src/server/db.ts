import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * The service-role Supabase client.
 *
 * This key bypasses every row-level policy, so it must never reach the
 * browser. Importing "server-only" at the top makes that a build error
 * rather than a leak.
 *
 * In the prototype the browser held the anon key and wrote to `bills` and
 * `pda_balances` directly, which meant anyone with the devtools open could
 * approve their own bill. All writes now go through the API routes, which
 * go through this client, which goes through the workflow functions.
 */

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY must both be set in the environment."
    );
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
