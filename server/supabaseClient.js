import { createClient } from "@supabase/supabase-js";

/** Normaliza URL copiada do painel (sem barra final, sem /rest/v1). */
export function normalizeSupabaseUrl(raw) {
  let url = String(raw || "").trim();
  if (!url) return "";
  url = url.replace(/\/+$/, "");
  if (url.endsWith("/rest/v1")) {
    url = url.slice(0, -"/rest/v1".length);
  }
  return url;
}

/** @returns {{ ok: boolean, url: string, issues: string[] }} */
export function validateSupabaseEnv() {
  const url = normalizeSupabaseUrl(process.env.SUPABASE_URL);
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const issues = [];

  if (!url) issues.push("Defina SUPABASE_URL no arquivo .env na raiz do projeto.");
  if (!key) issues.push("Defina SUPABASE_SERVICE_ROLE_KEY no arquivo .env (chave service_role).");

  if (url) {
    if (!/^https:\/\//i.test(url)) {
      issues.push("SUPABASE_URL deve começar com https://");
    }
    if (!url.includes(".supabase.co")) {
      issues.push(
        "SUPABASE_URL deve ser o Project URL (ex.: https://abcdefgh.supabase.co), não o link do painel do navegador."
      );
    }
    if (/\/dashboard\//i.test(url) || /supabase\.com\/project/i.test(url)) {
      issues.push(
        "Você colou o link do dashboard. Use Project Settings → API → Project URL."
      );
    }
  }

  if (key && key.length < 40) {
    issues.push("SUPABASE_SERVICE_ROLE_KEY parece incompleta — copie a chave service_role inteira.");
  }

  return { ok: issues.length === 0 && Boolean(url && key), url, issues };
}

/** @returns {boolean} */
export function isSupabaseConfigured() {
  return validateSupabaseEnv().ok;
}

/** @returns {import("@supabase/supabase-js").SupabaseClient | null} */
export function getSupabase() {
  const { ok, url } = validateSupabaseEnv();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!ok || !url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
