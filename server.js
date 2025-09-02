import express from "express";

const app = express();

// 必填環境變數：
// N8N_BASE = https://pei4.zeabur.app
// CORS_ALLOW_ORIGIN = https://pei4.github.io
const PORT = process.env.PORT || 3000;
const N8N_BASE = process.env.N8N_BASE;
const ORIGIN = process.env.CORS_ALLOW_ORIGIN;

if (!N8N_BASE || !ORIGIN) {
  console.error("請設定環境變數 N8N_BASE 與 CORS_ALLOW_ORIGIN");
  process.exit(1);
}

// 以 raw 方式接收所有 content-type，避免被 JSON 解析破壞原始 body
app.use(express.raw({ type: "*/*", limit: "10mb" }));

// 全域 CORS：任何請求都帶 ACAO；預檢一律在這層回 204
app.use((req, res, next) => {
  // 預檢
  if (req.method === "OPTIONS") {
    res.status(204)
      .set({
        "Access-Control-Allow-Origin": ORIGIN,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "X-API-Key, Content-Type",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin"
      })
      .end();
    return;
  }
  // 主請求回應也統一補 ACAO（其餘標頭由後續處理決定）
  res.set("Access-Control-Allow-Origin", ORIGIN);
  res.set("Vary", "Origin");
  next();
});

// 主要轉發：/n8n/* 轉到 N8N_BASE/webhook/*
// 若 /webhook/ 404，自動 fallback 到 /webhook-test/（方便未 Activate）
app.all("/n8n/*", async (req, res) => {
  try {
    const incoming = new URL(req.protocol + "://" + req.get("host") + req.originalUrl);
    const pathOnN8n = incoming.pathname.replace(/^\/n8n\//, "/webhook/");
    const search = incoming.search; // 保留原本 query

    // 從 query 取出 key，搬到 header；並從 query 移除 key（後端更乾淨）
    const t1 = new URL(pathOnN8n + search, N8N_BASE);
    const key = t1.searchParams.get("key") || "";
    t1.searchParams.delete("key");

    const init = {
      method: req.method,
      headers: {
        "X-API-Key": key,
        "Content-Type": req.get("Content-Type") || "application/json"
      },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body
    };

    // 先嘗試正式 webhook
    let r = await fetch(t1.toString(), init);

    // 未啟用或路徑不在正式 URL 時，fallback 到 webhook-test
    if (r.status === 404) {
      const t2 = new URL(t1.toString().replace("/webhook/", "/webhook-test/"));
      r = await fetch(t2.toString(), init);
    }

    // 轉回應（ACAO 已在全域中介層補上）
    res.status(r.status);
    // 保留 n8n 原本的回應標頭（除了 ACAO 已補）
    for (const [k, v] of r.headers.entries()) {
      if (k.toLowerCase() !== "content-length") res.setHeader(k, v);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.end(buf);
  } catch (err) {
    res
      .status(502)
      .type("application/json")
      .send(JSON.stringify({ error: "Proxy error", detail: String(err?.message || e
