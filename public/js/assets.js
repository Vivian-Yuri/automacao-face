/** @typedef {'ad_account' | 'page' | 'pixel'} AssetKind */

/** @typedef {{ id: string, kind: AssetKind, external_id: string, name: string }} SavedAsset */

const KIND_LABELS = {
  ad_account: "Conta de anúncios",
  page: "Página",
  pixel: "Pixel",
};

/** @type {Set<() => void>} */
const assetChangeListeners = new Set();

/** @type {Map<AssetKind, SavedAsset[]>} */
const cacheByKind = new Map();

let storageMode = "file";

export function onAssetsChanged(fn) {
  assetChangeListeners.add(fn);
  return () => assetChangeListeners.delete(fn);
}

function notifyAssetsChanged() {
  assetChangeListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

export function getStorageMode() {
  return storageMode;
}

export function kindLabel(kind) {
  return KIND_LABELS[kind] || kind;
}

export async function fetchAssetsStatus() {
  const res = await fetch("/api/assets/status");
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Não foi possível verificar o armazenamento.");
  }
  storageMode = data.storage || "file";
  return data;
}

/** @param {AssetKind} kind */
export async function loadAssets(kind, { force = false } = {}) {
  if (!force && cacheByKind.has(kind)) {
    return cacheByKind.get(kind) || [];
  }
  const url = new URL("/api/assets", window.location.origin);
  url.searchParams.set("kind", kind);
  const res = await fetch(url.toString());
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Falha ao carregar cadastros.");
  }
  storageMode = data.storage || storageMode;
  const items = Array.isArray(data.items) ? data.items : [];
  cacheByKind.set(kind, items);
  return items;
}

export function invalidateAssetsCache(kind) {
  if (kind) cacheByKind.delete(kind);
  else cacheByKind.clear();
  notifyAssetsChanged();
}

/** @param {{ kind: AssetKind, external_id: string, name: string }} payload */
export async function createAssetItem(payload) {
  const res = await fetch("/api/assets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Falha ao salvar.");
  }
  invalidateAssetsCache(payload.kind);
  return data.item;
}

/** @param {string} id @param {{ external_id?: string, name?: string }} patch @param {AssetKind} kind */
export async function updateAssetItem(id, patch, kind) {
  const res = await fetch(`/api/assets/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Falha ao atualizar.");
  }
  invalidateAssetsCache(kind);
  return data.item;
}

/** @param {string} id @param {AssetKind} kind */
export async function deleteAssetItem(id, kind) {
  const res = await fetch(`/api/assets/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Falha ao excluir.");
  }
  invalidateAssetsCache(kind);
}

function filterItems(items, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (item) =>
      item.name.toLowerCase().includes(q) ||
      item.external_id.toLowerCase().includes(q)
  );
}

function renderPickerResults(listEl, items, onPick) {
  if (!listEl) return;
  listEl.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "interest-option empty";
    empty.textContent = "Nenhum cadastro. Adicione em «Cadastros».";
    listEl.appendChild(empty);
    listEl.hidden = false;
    return;
  }
  items.forEach((item) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "interest-option";
    btn.innerHTML = `<strong>${escapeHtml(item.name)}</strong><span class="muted fine">${escapeHtml(
      item.external_id
    )}</span>`;
    btn.addEventListener("click", () => {
      onPick(item);
      listEl.hidden = true;
    });
    listEl.appendChild(btn);
  });
  listEl.hidden = false;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Lista ao focar/clicar no campo; filtra enquanto digita.
 * @param {{ wrap: HTMLElement, kind: AssetKind, inputName: string }} opts
 */
export function wireEntityPicker({ wrap, kind, inputName }) {
  const input = wrap.querySelector(`[name="${inputName}"]`);
  const list = wrap.querySelector(".entity-picker-results");
  if (!input || !list) return;

  let items = [];
  let loading = false;

  async function refreshItems() {
    if (loading) return items;
    loading = true;
    try {
      items = await loadAssets(kind);
    } catch (err) {
      items = [];
      list.hidden = false;
      const errDiv = document.createElement("div");
      errDiv.className = "interest-option empty";
      errDiv.textContent = err instanceof Error ? err.message : String(err);
      list.innerHTML = "";
      list.appendChild(errDiv);
    } finally {
      loading = false;
    }
    return items;
  }

  function showList() {
    const filtered = filterItems(items, input.value);
    renderPickerResults(list, filtered, (item) => {
      input.value = item.external_id;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  input.addEventListener("focus", async () => {
    await refreshItems();
    showList();
  });

  input.addEventListener("click", async () => {
    await refreshItems();
    showList();
  });

  input.addEventListener("input", async () => {
    if (!items.length) await refreshItems();
    showList();
  });

  document.addEventListener("click", (ev) => {
    if (!wrap.contains(ev.target)) list.hidden = true;
  });

  onAssetsChanged(async () => {
    items = await loadAssets(kind, { force: true });
    if (document.activeElement === input && !list.hidden) showList();
  });
}

const CADASTRO_KINDS = /** @type {const} */ (["ad_account", "page", "pixel"]);

/** @param {HTMLElement} panel */
export function initCadastrosPanel(panel) {
  const statusEl = panel.querySelector("#cadastros-storage-status");
  const flashEl = panel.querySelector("#cadastros-flash");

  /** @param {string} msg @param {'ok'|'err'|''} type */
  function flash(msg, type = "") {
    if (!flashEl) return;
    flashEl.hidden = !msg;
    flashEl.textContent = msg;
    flashEl.classList.remove("ok", "err");
    if (type) flashEl.classList.add(type);
  }

  async function refreshStatus() {
    try {
      const data = await fetchAssetsStatus();
      if (!statusEl) return;
      const lines = [];
      if (data.supabaseConfigured && data.connection?.ok) {
        lines.push(
          "Armazenamento: Supabase — lista remota compartilhada (Render, proxies, etc.)."
        );
      } else if (data.supabaseConfigured && data.connection && !data.connection.ok) {
        lines.push("Supabase configurado no .env, mas a conexão falhou:");
        (data.connection.issues || []).forEach((i) => lines.push(`• ${i}`));
      } else {
        lines.push(
          "Armazenamento: arquivo local (data/meta-assets.json) — só nesta máquina."
        );
        lines.push(data.envFileHint || "Crie o arquivo .env e reinicie o servidor.");
        const issues = data.validation?.issues || [];
        if (issues.length) {
          lines.push("Falta configurar:");
          issues.forEach((i) => lines.push(`• ${i}`));
        }
      }
      statusEl.textContent = lines.join("\n");
    } catch (err) {
      if (statusEl) {
        statusEl.textContent =
          err instanceof Error ? err.message : String(err);
      }
    }
  }

  /** @param {AssetKind} kind */
  async function renderList(kind) {
    const listEl = panel.querySelector(`[data-asset-list="${kind}"]`);
    if (!listEl) return;
    listEl.innerHTML = '<p class="fine muted">Carregando…</p>';
    try {
      const items = await loadAssets(kind, { force: true });
      if (!items.length) {
        listEl.innerHTML = '<p class="fine muted">Nenhum item cadastrado.</p>';
        return;
      }
      listEl.innerHTML = "";
      items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "asset-row";
        row.dataset.id = item.id;
        row.innerHTML = `
          <div class="asset-row-main">
            <strong class="asset-row-name"></strong>
            <span class="fine muted asset-row-id"></span>
          </div>
          <div class="asset-row-actions">
            <button type="button" class="btn ghost asset-edit-btn">Editar</button>
            <button type="button" class="btn ghost asset-delete-btn">Excluir</button>
          </div>
        `;
        row.querySelector(".asset-row-name").textContent = item.name;
        row.querySelector(".asset-row-id").textContent = item.external_id;

        row.querySelector(".asset-edit-btn")?.addEventListener("click", () => {
          const form = panel.querySelector(`[data-asset-form="${kind}"]`);
          if (!form) return;
          form.dataset.editingId = item.id;
          form.querySelector('[name="name"]').value = item.name;
          form.querySelector('[name="external_id"]').value = item.external_id;
          const submit = form.querySelector('[type="submit"]');
          if (submit) submit.textContent = "Salvar alterações";
          form.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });

        row.querySelector(".asset-delete-btn")?.addEventListener("click", async () => {
          if (!window.confirm(`Excluir «${item.name}»?`)) return;
          try {
            await deleteAssetItem(item.id, kind);
            flash("Excluído.", "ok");
            await renderList(kind);
          } catch (err) {
            flash(err instanceof Error ? err.message : String(err), "err");
          }
        });

        listEl.appendChild(row);
      });
    } catch (err) {
      listEl.innerHTML = `<p class="fine err-text">${
        err instanceof Error ? err.message : String(err)
      }</p>`;
    }
  }

  CADASTRO_KINDS.forEach((kind) => {
    const form = panel.querySelector(`[data-asset-form="${kind}"]`);
    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = form.querySelector('[name="name"]')?.value?.trim();
      const external_id = form.querySelector('[name="external_id"]')?.value?.trim();
      const editingId = form.dataset.editingId || "";
      if (!name || !external_id) {
        flash("Preencha nome e ID.", "err");
        return;
      }
      try {
        if (editingId) {
          await updateAssetItem(editingId, { name, external_id }, kind);
          flash("Atualizado.", "ok");
        } else {
          await createAssetItem({ kind, name, external_id });
          flash("Adicionado.", "ok");
        }
        delete form.dataset.editingId;
        form.reset();
        const submit = form.querySelector('[type="submit"]');
        if (submit) submit.textContent = "Adicionar";
        await renderList(kind);
      } catch (err) {
        flash(err instanceof Error ? err.message : String(err), "err");
      }
    });

    form?.querySelector(".asset-cancel-edit")?.addEventListener("click", () => {
      delete form.dataset.editingId;
      form.reset();
      const submit = form.querySelector('[type="submit"]');
      if (submit) submit.textContent = "Adicionar";
      flash("");
    });
  });

  refreshStatus();
  CADASTRO_KINDS.forEach((kind) => renderList(kind));

  onAssetsChanged(() => {
    CADASTRO_KINDS.forEach((kind) => renderList(kind));
  });
}
