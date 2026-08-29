import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * The browser Supabase client, holding the anon key.
 *
 * READ ONLY by convention. Every write in this application goes through
 * an API route, which checks the caller's role and calls a workflow
 * function. Nothing in the browser should insert or update a bill, a PDA
 * balance or an employee -- if it could, anybody with devtools open could
 * approve their own bill.
 */
export const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
);
