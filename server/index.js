import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import multer from "multer";
import { fileURLToPath } from "url";
import {
  runFacebookCampaignJob,
  searchAdInterests,
  normalizeAdAccountId,
  fetchAdAccountInfo,
} from "./facebookService.js";
import {
  listAssets,
  createAsset,
  updateAsset,
  deleteAsset,
  assertValidKind,
  getAssetsStorageMode,
  probeSupabaseConnection,
} from "./assetsService.js";
import { validateSupabaseEnv } from "./supabaseClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const uploadsDir = path.join(root, "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
  dest: uploadsDir,
  limits: {
    fileSize: 512 * 1024 * 1024,
    files: 50,
  },
  fileFilter: (_req, file, cb) => {
    const ok =
      /^video\//.test(file.mimetype) ||
      /\.(mp4|mov|m4v)$/i.test(file.originalname || "");
    if (ok) cb(null, true);
    else cb(new Error("Apenas arquivos de vídeo são aceitos (ex: .mp4, .mov)."));
  },
});

const app = express();
const PORT = Number(process.env.PORT) || 3847;
/** Meta + vídeos + miniaturas podem ultrapassar o timeout padrão do Node (~5 min); evita cortar POST e causar «Failed to fetch» no navegador. */
const REQUEST_TIMEOUT_MS = Math.max(
  120_000,
  Number(process.env.MDM_HTTP_REQUEST_TIMEOUT_MS) || 900_000
);

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(root, "public")));

/** @type {Map<string, Promise<unknown>>} */
const accountExecutionQueue = new Map();

function resolveAccountQueueKey(rawAdAccountId) {
  try {
    return normalizeAdAccountId(rawAdAccountId);
  } catch {
    const raw = String(rawAdAccountId || "").trim();
    return raw ? `raw:${raw}` : "raw:unknown";
  }
}

async function enqueueByAccount(accountKey, jobFn) {
  const previous = accountExecutionQueue.get(accountKey) || Promise.resolve();
  /** @type {() => void} */
  let releaseCurrent = () => {};
  const current = new Promise((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = previous.then(() => current);
  accountExecutionQueue.set(accountKey, tail);
  await previous;
  try {
    return await jobFn();
  } finally {
    releaseCurrent();
    if (accountExecutionQueue.get(accountKey) === tail) {
      accountExecutionQueue.delete(accountKey);
    }
  }
}

function cleanupFiles(files) {
  for (const f of files || []) {
    try {
      if (f?.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
    } catch {
      /* ignore */
    }
  }
}

app.post(
  "/api/facebook/create",
  (req, res, next) => {
    if (typeof req.setTimeout === "function") {
      req.setTimeout(REQUEST_TIMEOUT_MS);
    }
    if (typeof res.setTimeout === "function") {
      res.setTimeout(REQUEST_TIMEOUT_MS);
    }
    next();
  },
  (req, res, next) => {
    upload.any()(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          ok: false,
          error: err.message || "Falha no upload.",
        });
      }
      next();
    });
  },
  async (req, res) => {
    const files = req.files || [];
    try {
      const queueKey = resolveAccountQueueKey(req.body?.adAccountId);
      const result = await enqueueByAccount(queueKey, () =>
        runFacebookCampaignJob(req.body, files)
      );
      cleanupFiles(files);
      res.json({ ok: true, ...result });
    } catch (e) {
      cleanupFiles(files);
      const message = e instanceof Error ? e.message : String(e);
      res.status(400).json({ ok: false, error: message });
    }
  }
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "mdm-ads-dashboard" });
});

app.get("/api/assets/status", async (_req, res) => {
  const validation = validateSupabaseEnv();
  const storage = getAssetsStorageMode();
  let connection = null;
  if (storage === "supabase") {
    connection = await probeSupabaseConnection();
  }
  res.json({
    ok: true,
    storage,
    supabaseConfigured: storage === "supabase",
    envFileHint:
      "Crie o arquivo .env na raiz do projeto (copie de .env.example) e reinicie npm run start:fresh.",
    validation: {
      ok: validation.ok,
      issues: validation.issues,
    },
    connection,
  });
});

app.get("/api/assets", async (req, res) => {
  try {
    const kind = req.query.kind ? assertValidKind(req.query.kind) : undefined;
    const items = await listAssets(kind);
    return res.json({ ok: true, items, storage: getAssetsStorageMode() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return res.status(400).json({ ok: false, error: message });
  }
});

app.post("/api/assets", async (req, res) => {
  try {
    const kind = assertValidKind(req.body?.kind);
    const item = await createAsset({
      kind,
      external_id: req.body?.external_id,
      name: req.body?.name,
    });
    return res.json({ ok: true, item, storage: getAssetsStorageMode() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return res.status(400).json({ ok: false, error: message });
  }
});

app.patch("/api/assets/:id", async (req, res) => {
  try {
    const item = await updateAsset(req.params.id, {
      external_id: req.body?.external_id,
      name: req.body?.name,
    });
    return res.json({ ok: true, item, storage: getAssetsStorageMode() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return res.status(400).json({ ok: false, error: message });
  }
});

app.delete("/api/assets/:id", async (req, res) => {
  try {
    await deleteAsset(req.params.id);
    return res.json({ ok: true, storage: getAssetsStorageMode() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return res.status(400).json({ ok: false, error: message });
  }
});

app.get("/api/facebook/targeting-search", async (req, res) => {
  try {
    const accessToken = String(req.query.accessToken || "").trim();
    const query = String(req.query.q || "").trim();
    if (!accessToken) {
      return res.status(400).json({ ok: false, error: "Access Token é obrigatório." });
    }
    const items = await searchAdInterests({ accessToken, query });
    return res.json({ ok: true, items });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return res.status(400).json({ ok: false, error: message });
  }
});

async function respondWithAdAccountInfo(req, res) {
  try {
    const accessToken = String(
      req.body?.accessToken || req.query?.accessToken || ""
    ).trim();
    const adAccountId = String(
      req.body?.adAccountId || req.query?.adAccountId || ""
    ).trim();
    if (!accessToken) {
      return res.status(400).json({ ok: false, error: "Access Token é obrigatório." });
    }
    const info = await fetchAdAccountInfo({ accessToken, adAccountId });
    return res.json({ ok: true, ...info });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status =
      message.includes("inválido") && message.includes("conta") ? 400 : 502;
    return res.status(status).json({ ok: false, error: message });
  }
}

app.get("/api/facebook/ad-account", respondWithAdAccountInfo);

app.post("/api/facebook/ad-account", respondWithAdAccountInfo);

const server = app.listen(PORT, () => {
  console.log(`MDM Ads Dashboard — http://localhost:${PORT}`);
});

try {
  if ("requestTimeout" in server && server.requestTimeout !== undefined) {
    const cur =
      typeof server.requestTimeout === "number" ? server.requestTimeout : 0;
    server.requestTimeout = Math.max(cur, REQUEST_TIMEOUT_MS);
  }
  server.keepAliveTimeout = Math.max(Number(server.keepAliveTimeout) || 5000, REQUEST_TIMEOUT_MS);
  server.headersTimeout = Math.max(
    Number(server.headersTimeout) || 60000,
    server.keepAliveTimeout + 60000
  );
} catch (_) {
  /* versões mais antigas do Node podem não expor todas as propriedades */
}

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(
      `\nPorta ${PORT} já está em uso. O dashboard provavelmente já está rodando:\n` +
        `  http://localhost:${PORT}\n\n` +
        `Para usar outra porta: defina PORT (ex.: $env:PORT=3850 no PowerShell) e rode npm start.\n` +
        `Para liberar a porta, encerre o processo que está escutando (Gerenciador de Tarefas ou netstat).\n`
    );
    process.exit(1);
  }
  throw err;
});
