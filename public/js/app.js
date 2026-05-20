import { wireEntityPicker, initCadastrosPanel } from "./assets.js";

const panels = {
  meta: document.getElementById("panel-meta"),
  cadastros: document.getElementById("panel-cadastros"),
  google: document.getElementById("panel-google"),
  youtube: document.getElementById("panel-youtube"),
  tiktok: document.getElementById("panel-tiktok"),
};

function showPlatform(key) {
  const allowed = new Set(["meta", "cadastros", "google", "youtube", "tiktok"]);
  const k = allowed.has(key) ? key : "meta";
  Object.entries(panels).forEach(([id, el]) => {
    if (!el) return;
    const on = id === k;
    el.hidden = !on;
    el.classList.toggle("is-visible", on);
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    const active = btn.dataset.platform === k;
    btn.classList.toggle("is-active", active);
    if (active) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => showPlatform(btn.dataset.platform));
});

document.querySelectorAll(".js-back-meta").forEach((btn) => {
  btn.addEventListener("click", () => showPlatform("meta"));
});

const form = document.getElementById("fb-form");
const submitBtn = document.getElementById("fb-submit");
const resultEl = document.getElementById("fb-result");

const budgetLevelEl = document.getElementById("budget-level");
const adsetBudgetFields = document.getElementById("adset-budget-fields");
const campaignBudgetWrap = document.getElementById("campaign-budget-wrap");
const dailyBudgetCampaignEl = document.getElementById("daily-budget-campaign");
const hintCampaign = document.querySelector(".budget-hint-campaign");
const hintAdset = document.querySelector(".budget-hint-adset");
const bidStrategyNote = document.getElementById("bid-strategy-note");
const aboSetsContainer = document.getElementById("abosets-container");
const addAboSetBtn = document.getElementById("add-aboset-btn");

const countryIsoInput = document.getElementById("country-iso-input");
const countryIsoExpanded = document.getElementById("country-iso-expanded");
const adAccountCurrencyHint = document.getElementById("ad-account-currency-hint");
const accessTokenInput = form?.querySelector('[name="accessToken"]');
const adAccountIdInput = form?.querySelector('[name="adAccountId"]');

/** @returns {string | null} ID normalizado `act_*` ou null se incompleto/inválido. */
function normalizeAdAccountIdClient(raw) {
  const s = String(raw || "").trim().replace(/\s/g, "");
  if (!s) return null;
  if (s.startsWith("act_")) return s;
  if (/^\d+$/.test(s)) return `act_${s}`;
  return null;
}

let adAccountCurrencyDebounceTimer = null;

function refreshAdAccountCurrencyHint() {
  clearTimeout(adAccountCurrencyDebounceTimer);
  adAccountCurrencyDebounceTimer = setTimeout(runAdAccountCurrencyFetch, 420);
}

async function runAdAccountCurrencyFetch() {
  if (!adAccountCurrencyHint || !accessTokenInput || !adAccountIdInput) return;
  const token = accessTokenInput.value.trim();
  const normalized = normalizeAdAccountIdClient(adAccountIdInput.value);
  adAccountCurrencyHint.classList.remove("is-error");
  if (!token || !normalized) {
    adAccountCurrencyHint.hidden = true;
    adAccountCurrencyHint.textContent = "";
    return;
  }
  try {
    const res = await fetch("/api/facebook/ad-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessToken: token,
        adAccountId: normalized,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      adAccountCurrencyHint.hidden = false;
      adAccountCurrencyHint.textContent =
        data.error ||
        "Não foi possível identificar a moeda da conta. Confira token e ID.";
      adAccountCurrencyHint.classList.add("is-error");
      return;
    }
    const nome = String(data.name || "").trim();
    const label = String(data.currencyLabelPt || "").trim();
    const line = nome
      ? `Conta «${nome}»: orçamentos neste formulário são em ${label}.`
      : `Orçamentos neste formulário são em ${label}.`;
    adAccountCurrencyHint.hidden = false;
    adAccountCurrencyHint.textContent = line;
  } catch {
    adAccountCurrencyHint.hidden = false;
    adAccountCurrencyHint.textContent =
      "Erro ao consultar a conta. Servidor está rodando?";
    adAccountCurrencyHint.classList.add("is-error");
  }
}

accessTokenInput?.addEventListener("change", refreshAdAccountCurrencyHint);
accessTokenInput?.addEventListener("blur", refreshAdAccountCurrencyHint);
accessTokenInput?.addEventListener("input", refreshAdAccountCurrencyHint);
adAccountIdInput?.addEventListener("change", refreshAdAccountCurrencyHint);
adAccountIdInput?.addEventListener("blur", refreshAdAccountCurrencyHint);
adAccountIdInput?.addEventListener("input", refreshAdAccountCurrencyHint);

function formatAudienceSize(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return "";
  return new Intl.NumberFormat("pt-BR").format(Number(value));
}

function getAccessToken() {
  return form?.querySelector('[name="accessToken"]')?.value?.trim() || "";
}

/** @typedef {{ width: number, height: number, durationSec: number }} VideoProbe */

/** @returns {Promise<VideoProbe>} */
function probeVideoFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.playsInline = true;
    v.muted = true;
    const cleanup = () => URL.revokeObjectURL(url);

    const onReady = () => {
      cleanup();
      v.removeAttribute("src");
      const width = Number(v.videoWidth || 0);
      const height = Number(v.videoHeight || 0);
      const dur = Number(v.duration);
      resolve({
        width,
        height,
        durationSec: Number.isFinite(dur) ? dur : NaN,
      });
    };

    v.addEventListener("loadedmetadata", onReady, { once: true });
    v.addEventListener(
      "error",
      () => {
        cleanup();
        reject(new Error("Não foi possível ler o vídeo (formato pode ser incompatível.)"));
      },
      { once: true }
    );
    v.src = url;
  });
}

/** @enum-like */
function videoShapeCategory(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return "unknown";
  const r = w / h;
  if (Math.abs(Math.log(r)) < Math.log(1.06)) return "square";
  return r >= 1.05 ? "landscape" : "portrait";
}

function gcd(a, b) {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function approximateAspect(width, height) {
  const w = Math.round(width);
  const h = Math.round(height);
  if (w <= 0 || h <= 0) return "";
  const d = gcd(w, h);
  return `${w / d}:${h / d}`;
}

function formatDuration(sec) {
  if (!Number.isFinite(sec)) return "–";
  if (sec < 60) return `${Math.round(sec)} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m} min ${s} s`;
}

function summarizeVideoIssues(fileMeta) {
  const lines = [];
  const { width, height, durationSec } = fileMeta;
  const name = fileMeta.file?.name || "vídeo";
  const shortEdge = Number.isFinite(width) && Number.isFinite(height)
    ? Math.min(width, height)
    : NaN;

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return [`${name}: não conseguimos ler resolução; exporte como MP4 (H.264).`];
  }

  lines.push(
    `${name}: ${width}×${height} (${approximateAspect(
      width,
      height
    )}), ${formatDuration(durationSec)}`
  );

  if (Number.isFinite(durationSec)) {
    if (durationSec < 3)
      lines.push("Muito curto (< 3 s) pode ser recusado em algumas veiculações.");
    else if (durationSec > 120)
      lines.push(
        "Durações longas às vezes precisam de corte conforme objetivo/anúncio — confira na Meta."
      );
  }

  if (Number.isFinite(shortEdge) && shortEdge < 600) {
    lines.push(
      "Resolução baixa pode gerar erro em Feed ou Reels — prefira pelo menos ~1080 px no lado maior."
    );
  }

  const shape = videoShapeCategory(width, height);
  const portraitTallRatio = Number(height) / Number(width);
  if (shape === "landscape") {
    lines.push(
      "Formato mais largo que alto tende a falhar em Stories, Reels e In-stream para Reels. Prefira vídeo vertical 1080×1920 (9:16) quando quiser aparecer bem nesses formatos."
    );
  } else if (shape === "square") {
    lines.push(
      "Formato quadrado pode ser cortado ou recusado em Reels e Stories; 9:16 costuma funcionar melhor lá."
    );
  } else if (
    shape === "portrait" &&
    Number.isFinite(portraitTallRatio) &&
    portraitTallRatio > 1 &&
    portraitTallRatio < 1.5
  ) {
    lines.push(
      "Vertical mais baixo (por exemplo ~4:5) costuma servir bem no feed; Stories e Reels combinam bem com proporções bem próximas de 9:16."
    );
  }

  return lines;
}

function renderVideoScan(card) {
  const out = card.querySelector(".abo-video-scan");
  if (!out) return;
  const input = card.querySelector(".abo-videos");
  const files = input?.files?.length ? Array.from(input.files) : [];
  if (!files.length) {
    out.textContent = "";
    out.hidden = true;
    return;
  }

  out.hidden = false;
  out.textContent = "Analisando vídeos…";

  /** @type {any} */
  const cardTagged = card;
  cardTagged._videoScanGeneration = (cardTagged._videoScanGeneration || 0) + 1;
  const generation = cardTagged._videoScanGeneration;

  const fileListSnapshot = [...files];
  (async () => {
    /** @type {string[]} */
    const linesOut = [];
    /** @type {Set<string>} */
    const kinds = new Set();

    try {
      for (const file of fileListSnapshot) {
        try {
          const probe = await probeVideoFile(file);
          const meta = { file, ...probe };
          const cat = videoShapeCategory(meta.width, meta.height);
          if (cat && cat !== "unknown") kinds.add(cat);
          summarizeVideoIssues(meta).forEach((ln) => linesOut.push(ln));
        } catch (e) {
          linesOut.push(
            `${file.name}: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }

      if (
        kinds.has("landscape") &&
        (kinds.has("portrait") || kinds.has("square"))
      ) {
        linesOut.push(
          "Este conjunto mistura proporções diferentes: as mesmas posições valem para todos os anúncios — por isso um vídeo pode aparecer não veiculável em Reels/Stories enquanto outro não."
        );
      }

      if (generation !== cardTagged._videoScanGeneration) return;
      out.textContent = linesOut.join("\n\n");
      out.hidden = false;
    } catch (err) {
      if (generation !== cardTagged._videoScanGeneration) return;
      out.textContent = err instanceof Error ? err.message : String(err);
      out.hidden = false;
    }
  })();
}

function regionDisplayName(isoAlpha2) {
  const raw = String(isoAlpha2 || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(raw)) return "";
  try {
    const dn = new Intl.DisplayNames(["pt-BR"], { type: "region" });
    const name = dn.of(raw);
    return name && typeof name === "string" ? name : "";
  } catch {
    return "";
  }
}

function syncCountryIsoUi() {
  if (!countryIsoInput || !countryIsoExpanded) return;
  countryIsoInput.value = countryIsoInput.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
  const nm = regionDisplayName(countryIsoInput.value);
  countryIsoExpanded.textContent = nm ? `País: ${nm}` : "";
}

countryIsoInput?.addEventListener("input", syncCountryIsoUi);
countryIsoInput?.addEventListener("blur", syncCountryIsoUi);
syncCountryIsoUi();

async function searchTargetingOptions(query) {
  const accessToken = getAccessToken();
  if (!accessToken) {
    throw new Error("Preencha o Token de acesso para buscar direcionamentos.");
  }
  const url = new URL("/api/facebook/targeting-search", window.location.origin);
  url.searchParams.set("accessToken", accessToken);
  url.searchParams.set("q", query);
  const res = await fetch(url.toString(), { method: "GET" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Falha ao buscar direcionamentos.");
  }
  return Array.isArray(data.items) ? data.items : [];
}

function renderSelectedInterests(card) {
  const selectedEl = card.querySelector(".abo-interests-selected");
  if (!selectedEl) return;
  const selected = card._selectedInterests || [];
  selectedEl.innerHTML = "";
  if (!selected.length) {
    selectedEl.innerHTML =
      '<span class="fine muted">Nenhum direcionamento selecionado.</span>';
    return;
  }
  selected.forEach((item) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "interest-chip";
    chip.textContent = item.name;
    chip.title = "Remover";
    chip.addEventListener("click", () => {
      card._selectedInterests = (card._selectedInterests || []).filter(
        (x) => x.id !== item.id
      );
      renderSelectedInterests(card);
    });
    selectedEl.appendChild(chip);
  });
}

function renderInterestResults(card, items) {
  const list = card.querySelector(".abo-interest-results");
  if (!list) return;
  list.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "interest-option empty";
    empty.textContent = "Nenhuma opção encontrada.";
    list.appendChild(empty);
    list.hidden = false;
    return;
  }
  const selected = card._selectedInterests || [];
  items.forEach((item) => {
    if (selected.some((x) => x.id === item.id)) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "interest-option";
    const size = formatAudienceSize(item.audience_size);
    btn.innerHTML = size
      ? `<strong>${item.name}</strong><span class="muted fine">Público estimado: ${size}</span>`
      : `<strong>${item.name}</strong>`;
    btn.addEventListener("click", () => {
      card._selectedInterests = [...selected, { id: item.id, name: item.name }];
      renderSelectedInterests(card);
      list.hidden = true;
      const input = card.querySelector(".abo-interest-search");
      if (input) input.value = "";
    });
    list.appendChild(btn);
  });
  list.hidden = list.childElementCount === 0;
}

function wireInterestLookup(card) {
  card._selectedInterests = card._selectedInterests || [];
  renderSelectedInterests(card);
  const input = card.querySelector(".abo-interest-search");
  const results = card.querySelector(".abo-interest-results");
  let timer = null;
  input?.addEventListener("input", () => {
    const q = input.value.trim();
    if (timer) clearTimeout(timer);
    if (q.length < 2) {
      if (results) results.hidden = true;
      return;
    }
    timer = setTimeout(async () => {
      try {
        const items = await searchTargetingOptions(q);
        renderInterestResults(card, items);
      } catch (err) {
        if (results) {
          results.hidden = false;
          results.innerHTML = `<div class="interest-option empty">${
            err instanceof Error ? err.message : String(err)
          }</div>`;
        }
      }
    }, 300);
  });
  input?.addEventListener("focus", () => {
    if ((results?.childElementCount || 0) > 0) results.hidden = false;
  });
  document.addEventListener("click", (ev) => {
    if (!card.contains(ev.target) && results) results.hidden = true;
  });
}

function createAboSetCard(index) {
  const card = document.createElement("div");
  card.className = "abo-set-card";
  card.dataset.setIndex = String(index);
  card.innerHTML = `
    <div class="abo-set-card-head">
      <strong>Conjunto ${index + 1}</strong>
      <div class="abo-card-actions">
        <button type="button" class="btn ghost abo-duplicate-btn" aria-label="Duplicar conjunto">Duplicar</button>
        <button type="button" class="btn ghost abo-remove-btn" aria-label="Remover conjunto">Remover</button>
      </div>
    </div>
    <label class="field">
      <span>Nome do conjunto</span>
      <input type="text" class="abo-name" placeholder="Ex.: Público Lookalike 1%" required />
    </label>
    <label class="field abo-budget-wrap" hidden>
      <span>Orçamento diário deste conjunto (ABO)</span>
      <input type="number" class="abo-daily-budget" min="1" step="0.01" placeholder="50" />
    </label>
    <label class="field">
      <span>Direcionamento detalhado</span>
      <input type="text" class="abo-interest-search" placeholder="Digite para buscar interesses..." />
      <div class="abo-interest-results" hidden></div>
      <div class="abo-interests-selected"></div>
    </label>
    <label class="field">
      <span>Vídeos deste conjunto</span>
      <input type="file" class="abo-videos" accept="video/*,.mp4,.mov,.m4v" multiple required />
      <div class="abo-video-scan fine muted" hidden aria-live="polite"></div>
    </label>
  `;

  const removeBtn = card.querySelector(".abo-remove-btn");
  const duplicateBtn = card.querySelector(".abo-duplicate-btn");
  removeBtn?.addEventListener("click", () => {
    card.remove();
    refreshAboSetHeaders();
  });
  duplicateBtn?.addEventListener("click", () => {
    duplicateAboSet(card);
  });
  wireInterestLookup(card);
  const vidIn = card.querySelector(".abo-videos");
  vidIn?.addEventListener("change", () => renderVideoScan(card));
  return card;
}

function refreshAboSetHeaders() {
  const cards = aboSetsContainer?.querySelectorAll(".abo-set-card") || [];
  cards.forEach((card, idx) => {
    card.dataset.setIndex = String(idx);
    const title = card.querySelector(".abo-set-card-head strong");
    if (title) title.textContent = `Conjunto ${idx + 1}`;
  });
}

function ensureAboSetExists() {
  if (!aboSetsContainer) return;
  const cards = aboSetsContainer.querySelectorAll(".abo-set-card");
  if (!cards.length) {
    aboSetsContainer.appendChild(createAboSetCard(0));
  }
}

function appendAboSet() {
  if (!aboSetsContainer) return;
  const nextIndex = aboSetsContainer.querySelectorAll(".abo-set-card").length;
  aboSetsContainer.appendChild(createAboSetCard(nextIndex));
  refreshAboSetHeaders();
  syncBudgetLevelUi();
}

function duplicateAboSet(sourceCard) {
  if (!aboSetsContainer || !sourceCard) return;
  const nextIndex = aboSetsContainer.querySelectorAll(".abo-set-card").length;
  const clone = createAboSetCard(nextIndex);
  const name = sourceCard.querySelector(".abo-name")?.value || "";
  const budget = sourceCard.querySelector(".abo-daily-budget")?.value || "";
  clone.querySelector(".abo-name").value = name ? `${name} (cópia)` : "";
  clone.querySelector(".abo-daily-budget").value = budget;
  clone._selectedInterests = [...(sourceCard._selectedInterests || [])];
  renderSelectedInterests(clone);
  aboSetsContainer.appendChild(clone);
  refreshAboSetHeaders();
  syncBudgetLevelUi();
}

function syncBudgetLevelUi() {
  const isAdset = budgetLevelEl?.value === "adset";
  ensureAboSetExists();
  if (adsetBudgetFields) {
    adsetBudgetFields.hidden = !isAdset;
    adsetBudgetFields.style.display = isAdset ? "" : "none";
  }
  if (campaignBudgetWrap) {
    campaignBudgetWrap.hidden = isAdset;
    campaignBudgetWrap.style.display = isAdset ? "none" : "";
  }
  if (hintCampaign) hintCampaign.hidden = isAdset;
  if (hintAdset) hintAdset.hidden = !isAdset;
  if (bidStrategyNote) bidStrategyNote.hidden = !isAdset;
  const budgetInputs = aboSetsContainer?.querySelectorAll(".abo-budget-wrap") || [];
  budgetInputs.forEach((el) => {
    el.hidden = !isAdset;
    el.style.display = isAdset ? "" : "none";
  });
  const budgetNumbers = aboSetsContainer?.querySelectorAll(".abo-daily-budget") || [];
  budgetNumbers.forEach((input) => {
    input.required = isAdset;
  });
  if (dailyBudgetCampaignEl) dailyBudgetCampaignEl.required = !isAdset;
}

budgetLevelEl?.addEventListener("change", syncBudgetLevelUi);
addAboSetBtn?.addEventListener("click", appendAboSet);
syncBudgetLevelUi();

function setResult(text, type) {
  resultEl.hidden = false;
  resultEl.textContent = text;
  resultEl.classList.remove("ok", "err");
  if (type) resultEl.classList.add(type);
}

/** @param {unknown} err */
function formatFetchSubmitError(err) {
  const msg =
    typeof err !== "undefined" && err instanceof Error ? err.message : String(err ?? "");
  const low = msg.toLowerCase();
  if (
    (err instanceof TypeError &&
      (msg === "Failed to fetch" ||
        msg === "NetworkError when attempting to fetch resource.")) ||
    low.includes("networkerror") ||
    low.includes("load failed") ||
    low.includes("failed to fetch")
  ) {
    const protoOk =
      window.location.protocol === "http:" || window.location.protocol === "https:";
    const originHint =
      protoOk && window.location.origin
        ? `Use esta URL no navegador (não arquivo no disco): ${window.location.origin}.`
        : "Use http://localhost e a porta do terminal (por padrão 3847); não abra o HTML como arquivo.";
    return [
      "Não houve resposta do servidor («Failed to fetch»). Causas comuns:",
      "• Mantenha `npm run start` ou `npm run start:fresh` rodando e aguarde: ABO faz muitos uploads chamadas à Meta e pode demorar vários minutos.",
      `• ${originHint}`,
      "• Firewall, antivírus ou rede corporativa às vezes cortam POST longos.",
    ].join("\n");
  }
  return msg || "Erro desconhecido.";
}

document.querySelectorAll(".entity-picker-wrap").forEach((wrap) => {
  const input = wrap.querySelector("input[name]");
  const name = input?.getAttribute("name");
  if (name === "adAccountId") wireEntityPicker({ wrap, kind: "ad_account", inputName: name });
  else if (name === "pageId") wireEntityPicker({ wrap, kind: "page", inputName: name });
  else if (name === "pixelId") wireEntityPicker({ wrap, kind: "pixel", inputName: name });
});

const cadastrosPanel = document.getElementById("panel-cadastros");
if (cadastrosPanel) initCadastrosPanel(cadastrosPanel);

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  resultEl.hidden = true;
  const campaignType = form.querySelector('[name="campaignType"]')?.value;
  const pixelEl = form.querySelector('[name="pixelId"]');
  const pixel = (pixelEl?.value || "").trim();
  if (
    (campaignType === "VENDAS" || campaignType === "LEADS") &&
    !pixel
  ) {
    setResult(
      'Para "Vendas" ou "Leads", preencha o ID do Pixel no conjunto.',
      "err"
    );
    return;
  }

  submitBtn.disabled = true;
  const prev = submitBtn.textContent;
  submitBtn.textContent = "Criando…";

  try {
    const fd = new FormData(form);
    const isAbo = budgetLevelEl?.value === "adset";
    const cards = Array.from(
      aboSetsContainer?.querySelectorAll(".abo-set-card") || []
    );
    if (!cards.length) {
      setResult("Adicione ao menos um conjunto.", "err");
      return;
    }
    const adsetsConfig = [];
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const name = card.querySelector(".abo-name")?.value?.trim();
      const selectedInterests = card._selectedInterests || [];
      const dailyBudget = card.querySelector(".abo-daily-budget")?.value?.trim();
      const videoInput = card.querySelector(".abo-videos");
      const files = videoInput?.files ? Array.from(videoInput.files) : [];
      if (!name) {
        setResult(`No conjunto ${i + 1}, informe o nome.`, "err");
        return;
      }
      if (!files.length) {
        setResult(`No conjunto ${i + 1}, envie ao menos um vídeo.`, "err");
        return;
      }
      if (isAbo && !dailyBudget) {
        setResult(`No conjunto ${i + 1}, informe o orçamento diário ABO.`, "err");
        return;
      }
      const fileField = `adsetVideos_${i}`;
      files.forEach((file) => fd.append(fileField, file));
      adsetsConfig.push({
        name,
        selectedInterests,
        dailyBudget: isAbo ? dailyBudget : "",
        fileField,
      });
    }
    fd.append("adsetsConfig", JSON.stringify(adsetsConfig));

    const res = await fetch("/api/facebook/create", {
      method: "POST",
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      setResult(data.error || res.statusText || "Erro na requisição.", "err");
      return;
    }
    setResult(
      JSON.stringify(
        {
          sucesso: true,
          campaignId: data.campaignId,
          adSetId: data.adSetId,
          anuncios: data.ads,
        },
        null,
        2
      ),
      "ok"
    );
  } catch (err) {
    setResult(formatFetchSubmitError(err), "err");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = prev;
  }
});
