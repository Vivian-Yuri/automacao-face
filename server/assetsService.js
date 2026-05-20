import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getSupabase, isSupabaseConfigured } from "./supabaseClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const FILE_PATH = path.join(DATA_DIR, "meta-assets.json");

/** @typedef {'ad_account' | 'page' | 'pixel'} AssetKind */

/** @typedef {{ id: string, kind: AssetKind, external_id: string, name: string, created_at?: string, updated_at?: string }} SavedAsset */

const VALID_KINDS = new Set(["ad_account", "page", "pixel"]);

export function getAssetsStorageMode() {
  return isSupabaseConfigured() ? "supabase" : "file";
}

export function assertValidKind(kind) {
  const k = String(kind || "").trim();
  if (!VALID_KINDS.has(k)) {
    throw new Error('Tipo inválido. Use: "ad_account", "page" ou "pixel".');
  }
  return /** @type {AssetKind} */ (k);
}

function normalizeRow(row) {
  return {
    id: String(row.id),
    kind: row.kind,
    external_id: String(row.external_id || "").trim(),
    name: String(row.name || "").trim(),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE_PATH)) {
    fs.writeFileSync(FILE_PATH, JSON.stringify({ items: [] }, null, 2), "utf8");
  }
}

function readFileStore() {
  ensureDataFile();
  const raw = fs.readFileSync(FILE_PATH, "utf8");
  const parsed = JSON.parse(raw || '{"items":[]}');
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  return items.map((row) => normalizeRow(row));
}

function writeFileStore(items) {
  ensureDataFile();
  fs.writeFileSync(FILE_PATH, JSON.stringify({ items }, null, 2), "utf8");
}

function newLocalId() {
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** @param {AssetKind} [kind] */
export async function listAssets(kind) {
  if (isSupabaseConfigured()) {
    const supabase = getSupabase();
    let query = supabase
      .from("meta_saved_items")
      .select("id, kind, external_id, name, created_at, updated_at")
      .order("name", { ascending: true });
    if (kind) query = query.eq("kind", kind);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data || []).map(normalizeRow);
  }
  const all = readFileStore();
  if (!kind) return all;
  return all.filter((x) => x.kind === kind);
}

/** @param {{ kind: AssetKind, external_id: string, name: string }} payload */
export async function createAsset(payload) {
  const kind = assertValidKind(payload.kind);
  const external_id = String(payload.external_id || "").trim();
  const name = String(payload.name || "").trim();
  if (!external_id) throw new Error("Informe o ID.");
  if (!name) throw new Error("Informe o nome.");

  if (isSupabaseConfigured()) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("meta_saved_items")
      .insert({ kind, external_id, name })
      .select("id, kind, external_id, name, created_at, updated_at")
      .single();
    if (error) {
      if (error.code === "23505") {
        throw new Error("Já existe um item com este ID nesta categoria.");
      }
      throw new Error(error.message);
    }
    return normalizeRow(data);
  }

  const items = readFileStore();
  if (items.some((x) => x.kind === kind && x.external_id === external_id)) {
    throw new Error("Já existe um item com este ID nesta categoria.");
  }
  const now = new Date().toISOString();
  const row = {
    id: newLocalId(),
    kind,
    external_id,
    name,
    created_at: now,
    updated_at: now,
  };
  items.push(row);
  writeFileStore(items);
  return normalizeRow(row);
}

/** @param {string} id @param {{ external_id?: string, name?: string }} patch */
export async function updateAsset(id, patch) {
  const assetId = String(id || "").trim();
  if (!assetId) throw new Error("ID do registro é obrigatório.");

  const external_id =
    patch.external_id !== undefined
      ? String(patch.external_id || "").trim()
      : undefined;
  const name =
    patch.name !== undefined ? String(patch.name || "").trim() : undefined;
  if (external_id !== undefined && !external_id) throw new Error("Informe o ID.");
  if (name !== undefined && !name) throw new Error("Informe o nome.");

  if (isSupabaseConfigured()) {
    const supabase = getSupabase();
    const body = { updated_at: new Date().toISOString() };
    if (external_id !== undefined) body.external_id = external_id;
    if (name !== undefined) body.name = name;
    const { data, error } = await supabase
      .from("meta_saved_items")
      .update(body)
      .eq("id", assetId)
      .select("id, kind, external_id, name, created_at, updated_at")
      .single();
    if (error) {
      if (error.code === "23505") {
        throw new Error("Já existe um item com este ID nesta categoria.");
      }
      throw new Error(error.message);
    }
    if (!data) throw new Error("Registro não encontrado.");
    return normalizeRow(data);
  }

  const items = readFileStore();
  const idx = items.findIndex((x) => x.id === assetId);
  if (idx < 0) throw new Error("Registro não encontrado.");
  const current = items[idx];
  const nextExternal = external_id ?? current.external_id;
  const nextName = name ?? current.name;
  if (
    items.some(
      (x, i) =>
        i !== idx &&
        x.kind === current.kind &&
        x.external_id === nextExternal
    )
  ) {
    throw new Error("Já existe um item com este ID nesta categoria.");
  }
  const updated = {
    ...current,
    external_id: nextExternal,
    name: nextName,
    updated_at: new Date().toISOString(),
  };
  items[idx] = updated;
  writeFileStore(items);
  return normalizeRow(updated);
}

/** @param {string} id */
export async function deleteAsset(id) {
  const assetId = String(id || "").trim();
  if (!assetId) throw new Error("ID do registro é obrigatório.");

  if (isSupabaseConfigured()) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("meta_saved_items")
      .delete()
      .eq("id", assetId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Registro não encontrado.");
    return { id: assetId };
  }

  const items = readFileStore();
  const next = items.filter((x) => x.id !== assetId);
  if (next.length === items.length) throw new Error("Registro não encontrado.");
  writeFileStore(next);
  return { id: assetId };
}
