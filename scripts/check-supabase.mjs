/**
 * Verifica .env e conexão com Supabase.
 * Uso: node scripts/check-supabase.mjs
 */
import "dotenv/config";
import { validateSupabaseEnv } from "../server/supabaseClient.js";
import { probeSupabaseConnection } from "../server/assetsService.js";

const validation = validateSupabaseEnv();

console.log("\n=== MDM — verificação Supabase ===\n");

if (!validation.ok) {
  console.log("❌ Variáveis incompletas ou inválidas:\n");
  validation.issues.forEach((i) => console.log("  •", i));
  console.log("\nCrie o arquivo .env na raiz (copie de .env.example).");
  console.log("Depois reinicie: npm run start:fresh\n");
  process.exit(1);
}

console.log("✓ URL:", validation.url);
console.log("✓ Service role key definida\n");

const probe = await probeSupabaseConnection();
if (!probe.ok) {
  console.log("❌ Conexão com Supabase falhou:\n");
  probe.issues.forEach((i) => console.log("  •", i));
  console.log("\nExecute supabase/schema.sql no SQL Editor do projeto.\n");
  process.exit(1);
}

console.log("✓ Tabela meta_saved_items acessível");
console.log("\nPronto! Reinicie o servidor se ainda estiver rodando.\n");
