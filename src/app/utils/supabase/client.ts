// Re-export so the older import path keeps working.
// See src/lib/supabaseClient.ts -- reads only; writes go through /api.
export { supabase } from "@/lib/supabaseClient";
