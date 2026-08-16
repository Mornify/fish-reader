/**
 * Local stand-in for the Cloudflare Worker, used for development and for
 * proving the relay approach works before deploying. Same rules as index.js.
 *
 *   node worker/local-relay.mjs      → http://localhost:8787
 */
import http from "node:http";

const UPSTREAM = "https://api.fish.audio";
const ALLOWED_PATHS = new Set(["/v1/tts", "/v1/tts/stream/with-timestamp", "/model"]);

const cors = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, model",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
});

http
  .createServer(async (req, res) => {
    const origin = req.headers.origin || "";
    const url = new URL(req.url, "http://localhost");

    if (req.method === "OPTIONS") {
      res.writeHead(204, cors(origin));
      return res.end();
    }
    if (!ALLOWED_PATHS.has(url.pathname)) {
      res.writeHead(404, cors(origin));
      return res.end("Not found");
    }
    if (!req.headers.authorization) {
      res.writeHead(401, { ...cors(origin), "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Missing Authorization" }));
    }

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;

    const headers = { Authorization: req.headers.authorization };
    if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"];
    if (req.headers.model) headers.model = req.headers.model;

    try {
      const upstream = await fetch(UPSTREAM + url.pathname + url.search, {
        method: req.method,
        headers,
        body: req.method === "GET" ? undefined : body,
      });
      const out = { ...cors(origin) };
      const ct = upstream.headers.get("content-type");
      if (ct) out["Content-Type"] = ct;
      res.writeHead(upstream.status, out);
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      res.writeHead(502, { ...cors(origin), "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Couldn't reach Fish Audio." }));
    }
  })
  .listen(8787, () => console.log("relay on http://localhost:8787"));
