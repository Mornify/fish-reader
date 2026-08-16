/**
 * Local narration relay for development.
 *
 * This deliberately runs THE SAME handler that ships to production
 * (`api/relay.js`) rather than a re-implementation, so that testing against
 * localhost actually tests the code that will serve real users. A stand-in that
 * merely behaves similarly is how relay bugs reach production unnoticed.
 *
 *   node worker/local-relay.mjs      → http://localhost:8787
 *
 * The web app points here automatically when served from localhost.
 */
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const { default: handler } = await import(
  path.join(here, "..", "api", "relay.js")
);

const PORT = 8787;

// The browser talks to this from a different origin during development, so
// unlike production (where the relay is same-origin) it must answer preflight.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, model",
  "Access-Control-Max-Age": "86400",
};

createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS).end();
    return;
  }

  const url = `http://localhost:${PORT}${req.url}`;
  // the app calls /v1/tts; the production handler strips a leading /api
  const target = req.url.startsWith("/api") ? url : url.replace(/^(http:\/\/[^/]+)/, "$1/api");

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string" && !["host", "connection"].includes(k)) headers.set(k, v);
  }

  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
    headers.set("Content-Length", String(body.length));
  }

  try {
    const response = await handler(new Request(target, { method: req.method, headers, body }));
    const out = { ...CORS };
    response.headers.forEach((value, name) => {
      if (name.toLowerCase() !== "content-encoding") out[name] = value;
    });
    res.writeHead(response.status, out);
    if (response.body) {
      for await (const chunk of response.body) res.write(chunk);
    }
    res.end();
  } catch (error) {
    res.writeHead(500, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(error?.message ?? error) }));
  }
}).listen(PORT, () => {
  console.log(`narration relay (production handler) on http://localhost:${PORT}`);
});
