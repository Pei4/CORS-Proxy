// server.js
import express from "express";

const app = express();

/* ===== 可選：Node < 18 兼容（你是 24 也 OK，不會進來） ===== */
if (typeof fetch === "undefined") {
  const { default: nodeFetch } = await import("node-fetch");
  global.fetch = nodeFetch;
}

/* ===== 環境變數 =====
 * 必填：
 *   N8N_BASE          e.g. https://pei4.zeabur.app       （無尾斜線）
 *   CORS_ALLOW_ORIGIN e.g. https://pei4.github.io
 * 可選（若你的 n8n Webhook 開了 Basic Auth，Proxy 會代送）：
 *   BASIC_USER
 *   BASIC_PASS
 */
const PORT   = process.env.PORT || 3000;
const N8N_BASE = process.env.N8N_BASE || "";
const ORIGIN   = process.env.CORS_ALLOW_ORIGIN || "";
const BASIC_USER = process.env.BASIC_USER || "";
const BASIC_PASS = process.env.BASIC_PASS || "";

/* 原始 body：避免被 JSON parser 破壞，按原樣轉發 */
app.use(express.raw({ type: "*/*", limit: "10mb" }));

/* 健康檢查（建議把 Zeabur Startup/Health Probe 指到 /health） */
app.get("/health", (req, res) => {
  res.status(N8N_BASE && ORIGIN ? 200 : 500).json({
    ok: Boolean(N8N_BASE && ORIGIN),
    N8N_BASE: N8N_BASE ? "set" : "missing",
    CORS_ALLOW_ORIGIN: ORIGIN ? "set" : "missing",
  });
});
/* 根路徑也回 200，避免預設探針打 / 被判 404 */
app.get("/", (req, res) => res.status(200).send("OK"));

/* 全域 CORS：預檢直接回 204；主請求補 ACAO */
app.use((req, res, next) => {
  const origin = ORIGIN || "*"; // 若未設也不讓服務掛掉
  if (req.method === "OPTIONS") {
    res.status(204)
      .set({
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "X-API-Key, Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
      })
      .end();
    return;
  }
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  next();
});

/* 主要轉發：/n8n/* -> N8N_BASE/webhook/*，404 -> /webhook-test/* */
app.all("/n8n/*", async (req, res) => {
  if (!N8N_BASE) {
    res.status(500);
    res.type("application/json");
    res.send(JSON.stringify({ error: "N8N_BASE not set" }));
    return;
  }

  try {
    const incoming = new URL(req.protocol + "://" + req.get("host") + req.originalUrl);
    // 例：/n8n/get-ref-data -> /webhook/get-ref-data
    const pathOnN8n = incoming.pathname.replace(/^\/n8n\//, "/webhook/");
    const t1 = new URL(pathOnN8n + incoming.search, N8N_BASE);

    // 把 query 的 ?key= 轉成 Header：X-API-Key；並從 query 移除
    const apiKey = t1.searchParams.get("key") || "";
    t1.searchParams.delete("key");

    // 準備轉發參數
    const init = {
      method: req.method,
      headers: {
        // 帶給 n8n 的認證：X-API-Key（你在前端用 ?key=XXX 即可）
        "X-API-Key": apiKey,
        // 保留 Content-Type；若沒有就預設 application/json
        "Content-Type": req.get("Content-Type") || "application/json",
      },
      body: (req.method === "GET" || req.method === "HEAD") ? undefined : req.body,
    };

    // 如果有設定 BASIC_USER/PASS，代送 Authorization: Basic ...
    if (BASIC_USER && BASIC_PASS) {
      const token = Buffer.from(`${BASIC_USER}:${BASIC_PASS}`).toString("base64");
      init.headers.Authorization = `Basic ${token}`;
    }

    // 先打正式 webhook
    let r = await fetch(t1.toString(), init);

    // 若 404（未 Activate 或路徑只在 test 模式），fallback 到 /webhook-test/
    if (r.status === 404) {
      const t2 = new URL(t1.toString().replace("/webhook/", "/webhook-test/"));
      r = await fetch(t2.toString(), init);
    }

    // 把 n8n 的回應轉回給前端（CORS 已由上面的中介層補上）
    res.status(r.status);
    // 複製回應標頭（跳過 Content-Length，讓 Node 自算）
    for (const [k, v] of r.headers.entries()) {
      if (k.toLowerCase() !== "content-length") res.setHeader(k, v);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.end(buf);
  } catch (err) {
    console.error("[Proxy Error]", err);
    // 展開寫法，避免因自動換行造成語法錯
    res.status(502);
    res.type("application/json");
    const detail = (err && err.message) ? String(err.message) : String(err);
    res.send(JSON.stringify({ error: "Proxy error", detail }));
  }
});

/* 其他路徑：友善訊息（仍帶 CORS，避免被誤判為 CORS 錯誤） */
app.all("*", (req, res) => {
  res.status(404).json({ error: "Not Found", hint: "Use /n8n/<path>" });
});

/* 啟動 */
app.listen(PORT, () => {
  console.log(`CORS proxy listening on :${PORT}`);
});
