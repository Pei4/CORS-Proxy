import express from "express";

const app = express();

// 讀環境變數
const PORT = process.env.PORT || 3000;
// 你的 n8n 來源，例如 https://pei4.zeabur.app
const N8N_BASE = process.env.N8N_BASE || "https://pei4.zeabur.app";
// 允許的前端網域（你的 GitHub Pages）
const ORIGIN = process.env.CORS_ALLOW_ORIGIN || "https://pei4.github.io";

// 以 raw 方式接收任何 content-type，方便原封轉發
app.use(express.raw({ type: "*/*", limit: "5mb" }));

// 統一處理 /n8n/* 路徑
app.all("/n8n/*", async (req, res) => {
  // CORS 預檢
  if (req.method === "OPTIONS") {
    res
      .status(204)
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

  try {
    // 把 /n8n/... 轉給 n8n 的 /webhook/...
    const incomingUrl = new URL(req.protocol + "://" + req.get("host") + req.originalUrl);
    const pathOnProxy = incomingUrl.pathname; // /n8n/get-ref-data
    const pathOnN8n = pathOnProxy.replace(/^\/n8n\//, "/webhook/");

    const target = new URL(pathOnN8n + incomingUrl.search, N8N_BASE);

    // 從 query 取出 key -> 放到 Header；並從 query 移除 key（可選）
    const key = target.searchParams.get("key") || "";
    target.searchParams.delete("key");

    // 準備要轉送給 n8n 的請求
    const init = {
      method: req.method,
      headers: {
        // 轉送 Content-Type；若沒有，就先給個常見預設
        "Content-Type": req.get("Content-Type") || "application/json",
        "X-API-Key": key
      },
      // GET/HEAD 沒有 body
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body
    };

    const r = await fetch(target.toString(), init);

    // 回傳 n8n 的結果給瀏覽器，並補 CORS
    const respHeaders = new Headers(r.headers);
    respHeaders.set("Access-Control-Allow-Origin", ORIGIN);
    respHeaders.set("Vary", "Origin");

    // 直接串流回傳
    res.status(r.status);
    for (const [k, v] of respHeaders.entries()) res.setHeader(k, v);
    const arrayBuffer = await r.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
  } catch (err) {
    res
      .status(502)
      .set({
        "Access-Control-Allow-Origin": ORIGIN,
        Vary: "Origin",
        "Content-Type": "application/json"
      })
      .send(JSON.stringify({ error: "Proxy error", detail: String(err?.message || err) }));
  }
});

app.listen(PORT, () => {
  console.log(`CORS proxy listening on :${PORT}`);
});
