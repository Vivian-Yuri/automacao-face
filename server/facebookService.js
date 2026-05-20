import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import path from "path";

const GRAPH_VERSION = "v23.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const META_RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
const GRAPH_MIN_INTERVAL_MS = 1800;
let lastGraphRequestAt = 0;

export function normalizeAdAccountId(raw) {
  if (!raw) throw new Error("ID da conta de anúncios é obrigatório.");
  const s = String(raw).trim().replace(/\s/g, "");
  if (s.startsWith("act_")) return s;
  if (/^\d+$/.test(s)) return `act_${s}`;
  throw new Error(
    "ID da conta de anúncios inválido. Use números ou act_NUMERO."
  );
}

/** Rótulos em PT para moedas comuns das contas de anúncio (valor do orçamento é sempre na moeda da conta). */
export function adAccountCurrencyLabelPt(code) {
  const c = String(code || "").trim().toUpperCase();
  const map = {
    BRL: "Real brasileiro (BRL)",
    COP: "Peso colombiano (COP)",
    MXN: "Peso mexicano (MXN)",
    USD: "Dólar americano (USD)",
    EUR: "Euro (EUR)",
    PEN: "Sol peruano (PEN)",
    CLP: "Peso chileno (CLP)",
    ARS: "Peso argentino (ARS)",
    UYU: "Peso uruguaio (UYU)",
  };
  return map[c] || (c ? `Moeda da conta: ${c}` : "");
}

function toMinorUnits(amountStr, label = "Orçamento diário") {
  const n = Number(String(amountStr).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${label} inválido.`);
  }
  return Math.round(n * 100);
}

function objectiveMapping(campaignType) {
  const map = {
    TRAFEGO: {
      objective: "OUTCOME_TRAFFIC",
      optimization_goal: "LINK_CLICKS",
      billing_event: "LINK_CLICKS",
      usePixelOptimization: false,
    },
    VENDAS: {
      objective: "OUTCOME_SALES",
      optimization_goal: "OFFSITE_CONVERSIONS",
      billing_event: "IMPRESSIONS",
      usePixelOptimization: true,
    },
    LEADS: {
      objective: "OUTCOME_LEADS",
      optimization_goal: "OFFSITE_CONVERSIONS",
      billing_event: "IMPRESSIONS",
      usePixelOptimization: true,
    },
    RECONHECIMENTO: {
      objective: "OUTCOME_AWARENESS",
      optimization_goal: "REACH",
      billing_event: "IMPRESSIONS",
      usePixelOptimization: false,
    },
    ENGAJAMENTO: {
      objective: "OUTCOME_ENGAGEMENT",
      optimization_goal: "THRUPLAY",
      billing_event: "THRUPLAY",
      usePixelOptimization: false,
    },
  };
  const key = String(campaignType || "").toUpperCase();
  if (!map[key]) {
    throw new Error(`Tipo de campanha não suportado: ${campaignType}`);
  }
  return map[key];
}

function startTimeUnix(isoOrUnix) {
  if (!isoOrUnix) return null;
  const s = String(isoOrUnix).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) {
    throw new Error(
      "Data/hora de início inválida. Use o seletor do formulário ou timestamp Unix."
    );
  }
  return Math.floor(ms / 1000);
}

function parseFormBool(raw, defaultValue = false) {
  if (raw === undefined || raw === null) return defaultValue;
  const x = Array.isArray(raw) ? raw[0] : raw;
  const s = String(x).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "on") return true;
  if (s === "false" || s === "0" || s === "off" || s === "") return false;
  return defaultValue;
}

function parseBudgetLevel(raw) {
  const s = String(raw ?? "campaign").trim().toLowerCase();
  if (s === "adset" || s === "ad_set" || s === "conjunto") return "adset";
  return "campaign";
}

function appendMarketingParam(target, key, value) {
  if (value === undefined || value === null) return;
  if (key === "is_adset_budget_sharing_enabled") {
    const b =
      typeof value === "boolean"
        ? value
        : String(value).trim().toLowerCase() === "true" || String(value).trim() === "1";
    target.append(key, b ? "True" : "False");
    return;
  }
  if (typeof value === "boolean") {
    target.append(key, value ? "true" : "false");
    return;
  }
  if (typeof value === "object" && value !== null) {
    target.append(key, JSON.stringify(value));
    return;
  }
  target.append(key, String(value));
}

function isRetryableMetaRateLimitError(errObj) {
  if (!errObj || typeof errObj !== "object") return false;
  const code = Number(errObj.code);
  if (META_RATE_LIMIT_CODES.has(code)) return true;
  const msg = String(errObj.message || "").toLowerCase();
  return (
    msg.includes("request limit reached") ||
    msg.includes("too many calls") ||
    msg.includes("rate limit")
  );
}

function toMetaErrorMessage(prefix, errObj, fallback) {
  const message = errObj?.message || fallback;
  const userMessage = errObj?.error_user_msg;
  return `${prefix} ${message}${userMessage ? ` — ${userMessage}` : ""}`;
}

function computeRetryDelayMs(errObj, attempt, baseDelayMs) {
  const expDelay = Math.min(baseDelayMs * 2 ** (attempt - 1), 180000);
  const code = Number(errObj?.code);
  // Código 4 (e similares) costuma precisar de cooldown maior.
  if (META_RATE_LIMIT_CODES.has(code)) {
    return Math.max(expDelay, 60000);
  }
  return expDelay;
}

function isVideoStillProcessingErrorMessage(msg) {
  const text = String(msg || "").toLowerCase();
  return (
    text.includes("still processing") ||
    text.includes("video is processing") ||
    text.includes("video not ready") ||
    text.includes("not ready") ||
    text.includes("transcod") ||
    text.includes("processing")
  );
}

async function requestWithMetaRateLimitRetry(
  requestFn,
  { maxAttempts = 10, baseDelayMs = 5000 } = {}
) {
  /** @type {any} */
  let lastPayload = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const now = Date.now();
    const waitBeforeRequest = GRAPH_MIN_INTERVAL_MS - (now - lastGraphRequestAt);
    if (waitBeforeRequest > 0) {
      await sleep(waitBeforeRequest);
    }
    lastGraphRequestAt = Date.now();
    const payload = await requestFn();
    lastPayload = payload;
    const errObj = payload?.error;
    if (!errObj) return payload;
    const retryable = isRetryableMetaRateLimitError(errObj);
    if (!retryable || attempt === maxAttempts) return payload;
    const waitMs = computeRetryDelayMs(errObj, attempt, baseDelayMs);
    await sleep(waitMs);
  }
  return lastPayload;
}

async function graphPost(url, params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    appendMarketingParam(body, k, v);
  }
  const data = await requestWithMetaRateLimitRetry(async () => {
    const res = await axios.post(url, body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      validateStatus: () => true,
    });
    return res.data;
  });
  if (data.error) {
    throw new Error(toMetaErrorMessage("[Meta]", data.error, "Erro desconhecido"));
  }
  return data;
}

/** POST multipart (curl -F): mais fiel ao que a Graph API documenta para /adsets. */
async function graphPostMultipart(url, params) {
  const fd = new FormData();
  let accessToken = null;
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (k === "access_token") {
      accessToken = v;
      continue;
    }
    if (k === "is_adset_budget_sharing_enabled") {
      const b =
        typeof v === "boolean"
          ? v
          : String(v).trim().toLowerCase() === "true" || String(v).trim() === "1";
      fd.append(k, b ? "True" : "False");
    } else if (typeof v === "boolean") {
      fd.append(k, v ? "true" : "false");
    } else if (typeof v === "object" && v !== null) {
      fd.append(k, JSON.stringify(v));
    } else {
      fd.append(k, String(v));
    }
  }
  if (accessToken !== undefined && accessToken !== null) {
    fd.append("access_token", String(accessToken));
  }
  const data = await requestWithMetaRateLimitRetry(async () => {
    const res = await axios.post(url, fd, {
      headers: fd.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: () => true,
    });
    return res.data;
  });
  if (data.error) {
    throw new Error(toMetaErrorMessage("[Meta]", data.error, "Erro desconhecido"));
  }
  return data;
}

export async function fetchAdAccountInfo({ accessToken, adAccountId }) {
  const token = String(accessToken || "").trim();
  if (!token) throw new Error("Access Token é obrigatório.");
  const id = normalizeAdAccountId(adAccountId);
  const data = await requestWithMetaRateLimitRetry(async () => {
    const res = await axios.get(`${GRAPH}/${id}`, {
      params: {
        fields: "name,currency,account_status",
        access_token: token,
      },
      validateStatus: () => true,
    });
    return res.data;
  });
  if (data.error) {
    throw new Error(
      toMetaErrorMessage(
        "[Meta conta]",
        data.error,
        "Não foi possível ler os dados da conta de anúncios."
      )
    );
  }
  const currency = String(data.currency || "").trim().toUpperCase();
  if (!currency) {
    throw new Error(
      "[Meta conta] A Meta não devolveu a moeda da conta. Use o ID da conta de anúncios (act_… ou só números), não um ID só do Gerenciador de Negócios. Confira também permissões no token (ex.: ads_management / ads_read) para essa conta."
    );
  }
  return {
    name: String(data.name || "").trim(),
    currency,
    currencyLabelPt: adAccountCurrencyLabelPt(currency),
    accountStatus: String(data.account_status || "").trim(),
  };
}

function videoContentType(filename, mime) {
  const m = String(mime || "").toLowerCase();
  if (m.startsWith("video/")) return m;
  const ext = path.extname(filename || "").toLowerCase();
  if (ext === ".mov" || ext === ".qt") return "video/quicktime";
  return "video/mp4";
}

function normalizeVideoTitle(rawTitle, fallback = "Video") {
  const clean = String(rawTitle || "")
    .replace(/\.[^.]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return (clean || fallback).slice(0, 255);
}

export async function uploadAdVideo({
  adAccountId,
  filePath,
  originalName,
  mimeType,
  accessToken,
}) {
  const fd = new FormData();
  fd.append("access_token", accessToken);
  const name = originalName || path.basename(filePath);
  fd.append("title", normalizeVideoTitle(name, "Video"));
  fd.append("source", fs.createReadStream(filePath), {
    filename: name,
    contentType: videoContentType(name, mimeType),
  });
  const url = `${GRAPH}/${adAccountId}/advideos`;
  const data = await requestWithMetaRateLimitRetry(async () => {
    const res = await axios.post(url, fd, {
      headers: fd.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: () => true,
    });
    return res.data;
  });
  if (data.error) {
    throw new Error(
      toMetaErrorMessage("[Meta upload vídeo]", data.error, "Falha no upload")
    );
  }
  if (!data.id) throw new Error("Meta não retornou video_id no upload.");
  return data.id;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickThumbnailUri(videoPayload) {
  if (!videoPayload || typeof videoPayload !== "object") return null;
  const thumbs = videoPayload.thumbnails?.data;
  if (Array.isArray(thumbs) && thumbs.length) {
    const preferred = thumbs.find((t) => t.is_preferred);
    const t = preferred || thumbs[0];
    if (t?.uri) return String(t.uri).trim();
  }
  const pic = videoPayload.picture;
  if (typeof pic === "string" && pic.trim()) return pic.trim();
  if (pic && typeof pic === "object" && pic.data?.url) return String(pic.data.url).trim();
  return null;
}

async function fetchAdVideoThumbUrl(videoId, accessToken) {
  const data = await requestWithMetaRateLimitRetry(async () => {
    const res = await axios.get(`${GRAPH}/${videoId}`, {
      params: {
        fields: "thumbnails{uri,is_preferred,height,width},picture",
        access_token: accessToken,
      },
      validateStatus: () => true,
    });
    return res.data;
  });
  if (data.error) {
    throw new Error(
      toMetaErrorMessage("[Meta vídeo]", data.error, "Falha ao ler miniatura")
    );
  }
  return pickThumbnailUri(data);
}

async function fetchAdVideoMeta(videoId, accessToken) {
  const data = await requestWithMetaRateLimitRetry(async () => {
    const res = await axios.get(`${GRAPH}/${videoId}`, {
      params: {
        fields:
          "title,status,thumbnails{uri,is_preferred,height,width},picture",
        access_token: accessToken,
      },
      validateStatus: () => true,
    });
    return res.data;
  });
  if (data.error) {
    throw new Error(
      toMetaErrorMessage(
        "[Meta vídeo]",
        data.error,
        "Falha ao ler metadados do vídeo"
      )
    );
  }
  return data;
}

async function waitForAdVideoMeta(videoId, accessToken) {
  const maxAttempts = 30;
  const delayMs = 2000;
  /** @type {any | null} */
  let latest = null;
  for (let i = 0; i < maxAttempts; i++) {
    latest = await fetchAdVideoMeta(videoId, accessToken);
    const status = String(
      latest?.status?.video_status ||
        latest?.status?.processing_phase?.status ||
        latest?.status?.status ||
        ""
    )
      .trim()
      .toLowerCase();
    const hasThumb = Boolean(pickThumbnailUri(latest));
    const hasTitle = Boolean(String(latest?.title || "").trim());
    const ready =
      status === "ready" ||
      status === "complete" ||
      status === "processed" ||
      status === "finished";
    if (ready && (hasThumb || hasTitle)) return latest;
    await sleep(delayMs);
  }
  return latest;
}

async function waitForAdVideoThumbUrl(videoId, accessToken) {
  const maxAttempts = 10;
  const baseDelayMs = 4000;
  for (let i = 0; i < maxAttempts; i++) {
    const uri = await fetchAdVideoThumbUrl(videoId, accessToken);
    if (uri) return uri;
    const waitMs = Math.min(baseDelayMs * 2 ** i, 45000);
    await sleep(waitMs);
  }
  return null;
}

function firstHashFromAdImagesResponse(payload) {
  const images = payload?.images;
  if (!images || typeof images !== "object") return null;
  for (const v of Object.values(images)) {
    if (v && typeof v === "object" && v.hash) return String(v.hash);
  }
  return null;
}

async function registerImageUrlInAdLibrary(adAccountId, imageUrl, accessToken) {
  const body = new URLSearchParams();
  body.append("url", imageUrl);
  body.append("access_token", accessToken);
  const data = await requestWithMetaRateLimitRetry(async () => {
    const res = await axios.post(
      `${GRAPH}/${adAccountId}/adimages`,
      body.toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        validateStatus: () => true,
      }
    );
    return res.data;
  });
  if (data.error) return { ok: false, error: data.error, hash: null };
  const hash = firstHashFromAdImagesResponse(data);
  return { ok: Boolean(hash), error: null, hash };
}

async function registerImageBufferInAdLibrary(
  adAccountId,
  buffer,
  accessToken,
  filename = "video_thumb.jpg",
  contentType = "image/jpeg"
) {
  const fd = new FormData();
  fd.append("access_token", accessToken);
  fd.append("filename", buffer, {
    filename,
    contentType,
  });
  const data = await requestWithMetaRateLimitRetry(async () => {
    const res = await axios.post(`${GRAPH}/${adAccountId}/adimages`, fd, {
      headers: fd.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: () => true,
    });
    return res.data;
  });
  if (data.error) {
    throw new Error(
      toMetaErrorMessage("[Meta imagem]", data.error, "Falha ao enviar miniatura")
    );
  }
  const hash = firstHashFromAdImagesResponse(data);
  if (!hash) throw new Error("Meta não retornou image_hash ao registrar miniatura.");
  return hash;
}

async function ensureVideoThumbnailImageHash(adAccountId, videoId, accessToken) {
  const thumbUrl = await waitForAdVideoThumbUrl(videoId, accessToken);
  if (!thumbUrl) {
    throw new Error(
      "Miniatura do vídeo ainda não gerada pela Meta (timeout). Aguarde o processamento e tente de novo."
    );
  }
  const viaUrl = await registerImageUrlInAdLibrary(
    adAccountId,
    thumbUrl,
    accessToken
  );
  if (viaUrl.ok && viaUrl.hash) return viaUrl.hash;

  let img;
  try {
    img = await axios.get(thumbUrl, {
      responseType: "arraybuffer",
      maxRedirects: 5,
      timeout: 60000,
      validateStatus: (s) => s >= 200 && s < 400,
    });
  } catch (err) {
    throw new Error(
      `Não foi possível obter a miniatura do vídeo para o criativo. ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  const ct = String(img.headers["content-type"] || "").split(";")[0].trim();
  const ext =
    ct === "image/png"
      ? "png"
      : ct === "image/webp"
        ? "webp"
        : "jpg";
  const mime =
    ext === "png"
      ? "image/png"
      : ext === "webp"
        ? "image/webp"
        : "image/jpeg";
  const fname = `video_thumb.${ext}`;
  const buf = Buffer.from(img.data);
  return registerImageBufferInAdLibrary(
    adAccountId,
    buf,
    accessToken,
    fname,
    mime
  );
}

/**
 * Com campanha pausada, a Meta costuma criar conjuntos/anúncios já como PAUSED.
 * Um POST dedicado em cada nó força ACTIVE (sem mexer na campanha).
 */
async function activateGraphMarketingObject(accessToken, objectId) {
  const id = String(objectId ?? "").trim();
  if (!/^\d+$/.test(id)) {
    throw new Error(
      `Falha ao ativar na Meta: ID do objeto inválido (${String(objectId)}).`
    );
  }
  return graphPost(`${GRAPH}/${id}`, {
    status: "ACTIVE",
    access_token: accessToken,
  });
}

export async function createCampaign({
  adAccountId,
  name,
  campaignType,
  accessToken,
  dailyBudgetMinor,
  useCampaignBudget,
  isAdsetBudgetSharingEnabled,
}) {
  const { objective } = objectiveMapping(campaignType);
  const payload = {
    name,
    objective,
    status: "PAUSED",
    special_ad_categories: [],
    access_token: accessToken,
  };
  if (useCampaignBudget) {
    if (
      !Number.isFinite(Number(dailyBudgetMinor)) ||
      Number(dailyBudgetMinor) <= 0
    ) {
      throw new Error("Orçamento diário da campanha inválido.");
    }
    payload.daily_budget = dailyBudgetMinor;
    payload.bid_strategy = "LOWEST_COST_WITHOUT_CAP";
  } else {
    const sharingEnabled = parseFormBool(isAdsetBudgetSharingEnabled, false);
    payload.is_adset_budget_sharing_enabled = sharingEnabled ? "True" : "False";
  }
  return graphPost(`${GRAPH}/${adAccountId}/campaigns`, payload);
}

function parseAgeRange(ageMinRaw, ageMaxRaw) {
  const hasMin = String(ageMinRaw ?? "").trim() !== "";
  const hasMax = String(ageMaxRaw ?? "").trim() !== "";
  const min = hasMin ? Number(ageMinRaw) : null;
  const max = hasMax ? Number(ageMaxRaw) : null;
  if (hasMin && (!Number.isFinite(min) || min < 13 || min > 65)) {
    throw new Error("Idade mínima inválida. Use número entre 13 e 65.");
  }
  if (hasMax && (!Number.isFinite(max) || max < 13 || max > 65)) {
    throw new Error("Idade máxima inválida. Use número entre 13 e 65.");
  }
  if (min !== null && max !== null && min > max) {
    throw new Error("Idade mínima não pode ser maior que idade máxima.");
  }
  return { min, max };
}

function parseDetailedTargeting(raw) {
  if (raw && typeof raw === "object") {
    return raw;
  }
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s.startsWith("{") || s.startsWith("[")) {
    try {
      const obj = JSON.parse(s);
      if (!obj || typeof obj !== "object") {
        throw new Error("JSON vazio.");
      }
      return obj;
    } catch (err) {
      throw new Error(
        `Direcionamento detalhado em JSON inválido: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
  const ids = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((id) => {
      if (!/^\d+$/.test(id)) {
        throw new Error(
          "Direcionamento detalhado inválido. Use IDs numéricos separados por vírgula ou JSON completo."
        );
      }
      return { id };
    });
  if (!ids.length) return null;
  return { flexible_spec: [{ interests: ids }] };
}

function buildTargeting(country, ageMinRaw, ageMaxRaw, detailedTargetingRaw) {
  const code = String(country || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) {
    throw new Error("País inválido. Use código ISO de 2 letras (ex: BR, US).");
  }
  const targeting = { geo_locations: { countries: [code] } };
  // Obrigatório em contas/versões novas: habilita/desabilita explicitamente Advantage Audience.
  targeting.targeting_automation = { advantage_audience: 0 };
  const ageRange = parseAgeRange(ageMinRaw, ageMaxRaw);
  if (ageRange.min !== null) targeting.age_min = ageRange.min;
  if (ageRange.max !== null) targeting.age_max = ageRange.max;
  const detailed = parseDetailedTargeting(detailedTargetingRaw);
  if (detailed && typeof detailed === "object") {
    Object.assign(targeting, detailed);
  }
  return targeting;
}

function buildPromotedObject({
  pageId,
  pixelId,
  campaignType,
}) {
  const { usePixelOptimization } = objectiveMapping(campaignType);
  const page_id = String(pageId).trim();
  if (!page_id) throw new Error("ID da página é obrigatório.");

  if (!usePixelOptimization) {
    return { page_id };
  }
  const pixel = String(pixelId || "").trim();
  if (!pixel) {
    throw new Error(
      "Para este tipo de campanha, o Pixel ID é obrigatório no conjunto."
    );
  }
  const type = String(campaignType || "").toUpperCase();
  const custom_event_type = type === "LEADS" ? "LEAD" : "PURCHASE";
  return {
    page_id,
    pixel_id: pixel,
    custom_event_type,
  };
}

export async function createAdSet({
  adAccountId,
  name,
  campaignId,
  startTimeUnix: start,
  country,
  pageId,
  pixelId,
  campaignType,
  accessToken,
  useCampaignBudget,
  dailyBudgetMinor,
  dsaBeneficiary,
  dsaPayor,
  ageMin,
  ageMax,
  detailedTargeting,
}) {
  const { optimization_goal, billing_event, usePixelOptimization } =
    objectiveMapping(campaignType);

  const promoted_object = buildPromotedObject({
    pageId,
    pixelId,
    campaignType,
  });

  const beneficiary = String(dsaBeneficiary || "").trim();
  const payor = String(dsaPayor || "").trim() || beneficiary;
  if (!beneficiary) {
    throw new Error(
      "Informe quem está sendo promovido (beneficiário DSA), ex.: nome da marca ou cliente."
    );
  }

  /**
   * CBO: estratégia de lance fica na campanha (bid_strategy + daily_budget lá).
   * Se mandarmos bid_strategy no conjunto com CBO, a Meta às vezes interpreta como
   * lance com teto e exige bid_amount. ABO: maior volume só no conjunto.
   */
  /** @type {Record<string, unknown>} */
  const params = {
    name,
    campaign_id: campaignId,
    status: "ACTIVE",
    billing_event,
    optimization_goal,
    targeting: buildTargeting(country, ageMin, ageMax, detailedTargeting),
    promoted_object,
    dsa_beneficiary: beneficiary,
    dsa_payor: payor,
    access_token: accessToken,
  };

  const hasAdsetBudget =
    Number.isFinite(Number(dailyBudgetMinor)) && Number(dailyBudgetMinor) > 0;
  const isAboMode = !useCampaignBudget || hasAdsetBudget;

  if (isAboMode) {
    params.bid_strategy = "LOWEST_COST_WITHOUT_CAP";
    if (
      !Number.isFinite(Number(dailyBudgetMinor)) ||
      Number(dailyBudgetMinor) <= 0
    ) {
      throw new Error("Orçamento diário do conjunto inválido.");
    }
    params.daily_budget = dailyBudgetMinor;
  }

  if (start) params.start_time = start;

  if (usePixelOptimization) {
    params.attribution_spec = [
      {
        event_type: "CLICK_THROUGH",
        window_days: 7,
      },
      {
        event_type: "VIEW_THROUGH",
        window_days: 1,
      },
    ];
  }

  const url = `${GRAPH}/${adAccountId}/adsets`;
  return graphPost(url, params);
}

export async function createAdCreative({
  adAccountId,
  pageId,
  videoId,
  primaryText,
  headline,
  linkUrl,
  accessToken,
  contextualMultiAdsEnrollStatus,
  forceImageHash = true,
}) {
  const safeHeadline = String(headline || "").trim() || `Video ${videoId}`;
  const imageHash = forceImageHash
    ? await ensureVideoThumbnailImageHash(adAccountId, String(videoId), accessToken)
    : null;

  const videoData = {
    video_id: String(videoId),
    message: String(primaryText || "").trim(),
    title: safeHeadline,
    call_to_action: {
      type: "LEARN_MORE",
      value: { link: String(linkUrl || "").trim() },
    },
  };
  if (imageHash) {
    videoData.image_hash = imageHash;
  }
  const object_story_spec = {
    page_id: String(pageId).trim(),
    video_data: videoData,
  };

  /** @type {Record<string, unknown>} */
  const payload = {
    name: `Creative ${videoId}`,
    object_story_spec,
    access_token: accessToken,
  };

  const enroll = String(contextualMultiAdsEnrollStatus || "").toUpperCase();
  if (enroll === "OPT_IN" || enroll === "OPT_OUT") {
    payload.contextual_multi_ads = { enroll_status: enroll };
  }

  return graphPost(`${GRAPH}/${adAccountId}/adcreatives`, payload);
}

async function createAdCreativeResilient(args) {
  const maxAttempts = 8;
  const baseDelayMs = 8000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await createAdCreative({
        ...args,
        forceImageHash: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!isVideoStillProcessingErrorMessage(message) || attempt === maxAttempts) {
        throw err;
      }
      const waitMs = Math.min(baseDelayMs * 2 ** (attempt - 1), 60000);
      await sleep(waitMs);
    }
  }
  throw new Error("Não foi possível criar o criativo de vídeo após várias tentativas.");
}

export async function createAd({
  adAccountId,
  adSetId,
  creativeId,
  name,
  accessToken,
  dsaBeneficiary,
  dsaPayor,
}) {
  const beneficiary = String(dsaBeneficiary || "").trim();
  const payor = String(dsaPayor || "").trim() || beneficiary;
  return graphPost(`${GRAPH}/${adAccountId}/ads`, {
    name,
    adset_id: adSetId,
    creative: { creative_id: creativeId },
    status: "ACTIVE",
    dsa_beneficiary: beneficiary,
    dsa_payor: payor,
    access_token: accessToken,
  });
}

export async function searchAdInterests({ accessToken, query }) {
  const q = String(query || "").trim();
  if (!q || q.length < 2) return [];
  const data = await requestWithMetaRateLimitRetry(async () => {
    const res = await axios.get(`${GRAPH}/search`, {
      params: {
        type: "adinterest",
        q,
        limit: 15,
        locale: "pt_BR",
        access_token: accessToken,
      },
      validateStatus: () => true,
    });
    return res.data;
  });
  if (data.error) {
    throw new Error(
      toMetaErrorMessage("[Meta targeting]", data.error, "Falha ao buscar interesses")
    );
  }
  const list = Array.isArray(data?.data) ? data.data : [];
  return list
    .map((item) => ({
      id: String(item?.id || "").trim(),
      name: String(item?.name || "").trim(),
      audience_size: Number(item?.audience_size || 0) || null,
      path: Array.isArray(item?.path) ? item.path.filter(Boolean) : [],
    }))
    .filter((x) => x.id && x.name);
}

function assertHttpUrl(u) {
  const s = String(u || "").trim();
  if (!s) throw new Error("URL de destino (CTA) é obrigatória para vídeo.");
  try {
    const x = new URL(s);
    if (x.protocol !== "http:" && x.protocol !== "https:") {
      throw new Error();
    }
  } catch {
    throw new Error("URL de destino inválida. Use http(s)://...");
  }
  return s;
}

export async function runFacebookCampaignJob(body, videoFiles) {
  const {
    accessToken,
    adAccountId: rawAdAccount,
    pageId,
    primaryTitle,
    secondaryTitle,
    country,
    dailyBudgetCampaign,
    pixelId,
    campaignType,
    campaignName,
    startAt,
    linkUrl,
    multiAdvertiserAds,
    budgetLevel,
    adSetBudgetSharing,
    dsaBeneficiary,
    dsaPayor,
    ageMin,
    ageMax,
    detailedTargeting,
    adsetsConfig,
  } = body;

  if (!accessToken) throw new Error("Access Token é obrigatório.");
  assertHttpUrl(linkUrl);

  const adAccountId = normalizeAdAccountId(rawAdAccount);

  if (!videoFiles?.length) throw new Error("Envie ao menos um vídeo.");

  const st = startTimeUnix(startAt);
  const level = parseBudgetLevel(budgetLevel);
  const useCampaignBudget = level === "campaign";
  const campaignBudgetMinor = useCampaignBudget
    ? toMinorUnits(dailyBudgetCampaign, "Orçamento diário da campanha (CBO)")
    : null;
  const adsetBudgetSharingBool = parseFormBool(adSetBudgetSharing, false);
  const dsaBen = String(dsaBeneficiary ?? "").trim();
  const dsaPay = String(dsaPayor ?? "").trim();

  const campaign = await createCampaign({
    adAccountId,
    name: String(campaignName).trim(),
    campaignType,
    accessToken,
    dailyBudgetMinor: useCampaignBudget ? campaignBudgetMinor : undefined,
    useCampaignBudget,
    isAdsetBudgetSharingEnabled: adsetBudgetSharingBool,
  });

  const multiEnroll = String(multiAdvertiserAds || "OPT_OUT").toUpperCase();
  const enrollStatus =
    multiEnroll === "OPT_IN" || multiEnroll === "OPT_OUT"
      ? multiEnroll
      : "OPT_OUT";

  const ads = [];
  let firstAdSetId = null;

  const processUploadsForAdSet = async (adSetId, files) => {
    /** @type {Array<{ adSetId: string, adNameBase: string, videoId: string, videoLibraryTitle: string }>} */
    const uploaded = [];
    for (const f of files) {
      const adNameBase =
        path.parse(f.originalname || f.filename || "anuncio").name ||
        `anuncio_${ads.length + 1}`;

      const videoId = await uploadAdVideo({
        adAccountId,
        filePath: f.path,
        originalName: f.originalname,
        mimeType: f.mimetype,
        accessToken,
      });
      uploaded.push({
        adSetId,
        adNameBase,
        videoId,
        videoLibraryTitle: normalizeVideoTitle(adNameBase, adNameBase),
      });
    }
    return uploaded;
  };

  let parsedAdsets = [];
  try {
    parsedAdsets = JSON.parse(String(adsetsConfig || "[]"));
    if (!Array.isArray(parsedAdsets)) throw new Error("Formato inválido.");
  } catch {
    throw new Error(
      "A configuração dos conjuntos é inválida. Revise os dados e tente de novo."
    );
  }
  if (!parsedAdsets.length) {
    throw new Error("Adicione ao menos um conjunto.");
  }

  /** @type {Array<{ adSetId: string, files: any[] }>} */
  const adSetFilePlans = [];
  for (const setCfg of parsedAdsets) {
    const setName = String(setCfg?.name || "").trim();
    const fileField = String(setCfg?.fileField || "").trim();
    if (!setName) throw new Error("Todo conjunto precisa de nome.");
    if (!fileField) {
      throw new Error("Não foi possível identificar vídeos de um conjunto.");
    }
    const files = (videoFiles || []).filter((f) => f.fieldname === fileField);
    if (!files.length) {
      throw new Error(`O conjunto "${setName}" precisa de vídeos.`);
    }
    const adsetBudgetMinor = useCampaignBudget
      ? undefined
      : toMinorUnits(
          setCfg?.dailyBudget,
          `Orçamento diário do conjunto "${setName}" (ABO)`
        );
    const selectedInterests = Array.isArray(setCfg?.selectedInterests)
      ? setCfg.selectedInterests
          .map((x) => ({ id: String(x?.id || "").trim() }))
          .filter((x) => /^\d+$/.test(x.id))
      : [];
    const setDetailedTargeting =
      selectedInterests.length > 0
        ? { flexible_spec: [{ interests: selectedInterests }] }
        : setCfg?.detailedTargeting;

    const adSet = await createAdSet({
      adAccountId,
      name: setName,
      campaignId: campaign.id,
      startTimeUnix: st,
      country,
      pageId,
      pixelId,
      campaignType,
      accessToken,
      useCampaignBudget,
      dailyBudgetMinor: adsetBudgetMinor,
      dsaBeneficiary: dsaBen,
      dsaPayor: dsaPay || dsaBen,
      ageMin,
      ageMax,
      detailedTargeting: setDetailedTargeting,
    });
    await activateGraphMarketingObject(accessToken, adSet.id);
    if (!firstAdSetId) firstAdSetId = adSet.id;
    adSetFilePlans.push({ adSetId: adSet.id, files });
  }

  /** @type {Array<{ adSetId: string, adNameBase: string, videoId: string, videoLibraryTitle: string }>} */
  const uploadedVideos = [];
  // Etapa 1: sobe todos os vídeos e guarda video_id para reduzir picos de processamento.
  for (const plan of adSetFilePlans) {
    const list = await processUploadsForAdSet(plan.adSetId, plan.files);
    uploadedVideos.push(...list);
  }
  // Etapa 2: cria criativos/anúncios usando os video_id já enviados.
  for (const item of uploadedVideos) {
    const creative = await createAdCreativeResilient({
      adAccountId,
      pageId,
      videoId: item.videoId,
      primaryText: primaryTitle,
      headline: secondaryTitle || item.videoLibraryTitle,
      linkUrl,
      accessToken,
      contextualMultiAdsEnrollStatus: enrollStatus,
    });

    const ad = await createAd({
      adAccountId,
      adSetId: item.adSetId,
      creativeId: creative.id,
      name: item.adNameBase.slice(0, 200),
      accessToken,
      dsaBeneficiary: dsaBen,
      dsaPayor: dsaPay || dsaBen,
    });
    await activateGraphMarketingObject(accessToken, ad.id);

    ads.push({
      adId: ad.id,
      creativeId: creative.id,
      videoId: item.videoId,
      adSetId: item.adSetId,
      name: item.adNameBase,
    });
  }

  return {
    campaignId: campaign.id,
    adSetId: firstAdSetId,
    ads,
  };
}
