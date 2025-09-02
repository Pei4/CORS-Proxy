import express from "express";

const app = express();

// Node <18 保險：沒有全域 fetch 時載入 node-fetch
if (typeof fetch === "undefined") {
  const { default: nodeFetch } = await import("node-fetch");
  global.fetch = nodeFetch;
}

const PORT = process.env.PORT || 3000;
const N8N_BASE = process.env.N8N_BASE || "";
const ORIGIN = process.env.CORS_ALLOW_ORIGIN || "";

// 原始 body
app.use(express.raw({ type: "*/*", limit: "10mb" }));

// 健康檢查（Zeabur 可指到 /health）
app.get("/health", (req, res) => {
  res.status(N8N_BASE && ORIGIN ? 200 : 500).json({
    ok: Boolean(N8N_BASE && ORIGIN),
    N8N_BASE: N8N_BASE ? "set" : "missing",
    CORS_ALLOW_ORIGIN: ORIGIN ? "set" : "missing",
  });
});

// 也回應根路徑，避免預設健康檢查打 /
app.get("/", (req, res) => res.status(200).send("OK"));

// 全域 CORS：預檢直接回 204；主請求補 ACAO
app.use((req, res, next) => {
  const origin = ORIGIN || "*";
  if (req.method === "OPTIONS") {
    res.status(204)
      .set({
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "X-API-Key, Content-Type",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      })
      .end();
    return;
  }
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  next();
});

// /n8n/* -> N8N_BASE/webhook/*（404 時 fallback 到 /webhook-test/*）
app.all("/n8n/*", async (req, res) => {
  if (!N8N_BASE) return res.status(500).json({ error: "N8N_BASE not set" });
  try {
    const incoming = new URL(req.protocol + "://" + req.get("host") + req.originalUrl);
    const pathOnN8n = incoming.pathname.replace(/^\/n8n\//, "/webhook/");
    const t1 = new URL(pathOnN8n + incoming.search, N8N_BASE);

    const key = t1.searchParams.get("key") || "";
    t1.searchParams.delete("key");

    const init = {
      method: req.method,
      headers: {
        "X-API-Key": key,
        "Content-Type": req.get("Content-Type") || "application/json",
      },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
    };

    let r = await fetch(t1.toString(), init);
    if (r.status === 404) {
      const t2 = new URL(t1.toString().replace("/webhook/", "/webhook-test/"));
      r = await fetch(t2.toString(), init);
    }

    res.status(r.status);
    for (const [k, v] of r.headers.entries()) {
      if (k.toLowerCase() !== "content-length") res.setHeader(k, v);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.end(buf);
  } catch (err) {
    console.error("[Proxy Error]", err);
    res
      .status(502)
      .type("application/json")
      .send(JSON.stringify({ error: "Proxy error", detail: String(err?.message || err) }));
  }
});

// 其他路徑：友善訊息（仍帶 ACAO，避免誤判成 CORS）
app.all("*", (req, res) => {
  res.status(404).json({ error: "Not Found", hint: "Use /n8n/<path>" });
});

app.listen(PORT, () => {
  console.log(`CORS proxy listening on :${PORT}`);
});
