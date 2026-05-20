import { createClient } from "@supabase/supabase-js";

/** @returns {boolean} */
export function isSupabaseConfigured() {
  return Boolean(
    String(process.env.SUPABASE_URL || "").trim() &&
      String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
  );
}

/** @returns {import("@supabase/supabase-js").SupabaseClient | null} */
export function getSupabase() {
  const url = String(process.env.SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
