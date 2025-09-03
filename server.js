// server.js
import express from "express";

const app = express();

if (typeof fetch === "undefined") {
  const { default: nodeFetch } = await import("node-fetch");
  global.fetch = nodeFetch;
}

const PORT   = process.env.PORT || 3000;
const N8N_BASE = process.env.N8N_BASE || "";
const ORIGIN   = process.env.CORS_ALLOW_ORIGIN || "";
const BASIC_USER = process.env.BASIC_USER || "";
const BASIC_PASS = process.env.BASIC_PASS || "";

app.use(express.raw({ type: "*/*", limit: "10mb" }));

app.get("/health", (req, res) => {
  res.status(N8N_BASE && ORIGIN ? 200 : 500).json({
    ok: Boolean(N8N_BASE && ORIGIN),
    N8N_BASE: N8N_BASE ? "set" : "missing",
    CORS_ALLOW_ORIGIN: ORIGIN ? "set" : "missing",
  });
});
app.get("/", (req, res) => res.status(200).send("OK"));

app.use((req, res, next) => {
  const origin = ORIGIN || "*";
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

app.all("/n8n/*", async (req, res) => {
  if (!N8N_BASE) {
    res.status(500).json({ error: "N8N_BASE not set" });
    return;
  }

  try {
    const incoming = new URL(req.protocol + "://" + req.get("host") + req.originalUrl);
    const pathOnN8n = incoming.pathname.replace(/^\/n8n\//, "/webhook/");
    const t1 = new URL(pathOnN8n + incoming.search, N8N_BASE);

    const apiKey = t1.searchParams.get("key") || "";
    t1.searchParams.delete("key");

    const init = {
      method: req.method,
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": req.get("Content-Type") || "application/json",
      },
      body: (req.method === "GET" || req.method === "HEAD") ? undefined : req.body,
    };

    if (BASIC_USER && BASIC_PASS) {
      const token = Buffer.from(`${BASIC_USER}:${BASIC_PASS}`).toString("base64");
      init.headers.Authorization = `Basic ${token}`;
    }

    let r = await fetch(t1.toString(), init);
    if (r.status === 404) {
      const t2 = new URL(t1.toString().replace("/webhook/", "/webhook-test/"));
      r = await fetch(t2.toString(), init);
    }

    res.status(r.status);
    // 複製標頭（跳過 content-length / content-encoding）
    for (const [k, v] of r.headers.entries()) {
      const lk = k.toLowerCase();
      if (lk !== "content-length" && lk !== "content-encoding") {
        res.setHeader(k, v);
      }
    }
    res.setHeader("Cache-Control", "no-transform");

    // 直接以 text 回傳，避免再攜帶壓縮標頭
    const text = await r.text();
    res.send(text);
  } catch (err) {
    console.error("[Proxy Error]", err);
    res.status(502).json({ error: "Proxy error", detail: err?.message || String(err) });
  }
});

app.all("*", (req, res) => {
  res.status(404).json({ error: "Not Found", hint: "Use /n8n/<path>" });
});

app.listen(PORT, () => {
  console.log(`CORS proxy listening on :${PORT}`);
});
