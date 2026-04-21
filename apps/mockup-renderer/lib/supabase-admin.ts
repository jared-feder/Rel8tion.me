import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

let cachedClient: ReturnType<typeof createClient> | null = null;

export function getSupabaseAdmin() {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  if (!cachedClient) {
    cachedClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  return cachedClient;
}
