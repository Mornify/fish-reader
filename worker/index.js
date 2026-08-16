/**
 * Fish Reader narration relay.
 *
 * WHY THIS EXISTS
 * api.fish.audio serves CORS headers for GET /model, so a browser can list
 * voices directly. But its TTS endpoints answer a CORS preflight with a bare
 * 401 and no CORS headers, so a browser can never POST to them. This Worker is
 * the minimum piece of server needed to make the web app possible.
 *
 * WHAT IT DOES NOT DO — this is a privacy promise the code has to keep:
 *   - it does not store, log, or inspect the user's API key
 *   - it does not store or log the text being narrated
 *   - it holds no database, no accounts, no analytics
 * It receives the user's own key in the Authorization header, forwards the
 * request verbatim to Fish Audio, and streams the audio straight back.
 *
 * WHAT THE ORIGIN CHECK IS AND IS NOT
 * `Origin` is set by browsers and cannot be forged by page JavaScript, so the
 * allowlist does stop another website from pointing its users at this relay.
 * It is NOT a defence against curl, which can send any Origin it likes. That is
 * acceptable because every request must carry the caller's OWN Fish Audio key:
 * there is no shared credential here to steal and no way to spend someone
 * else's quota. The residual risk is someone burning this Worker's request
 * budget, which is a quota problem, not a security one — cap it with a
 * Cloudflare rate-limiting rule on the dashboard (see worker/README.md).
 *
 * Deploy:  npx wrangler deploy      (see worker/README.md)
 */

const UPSTREAM = "https://api.fish.audio";

// Only these origins may use the relay, so it can't be repurposed as an open
// proxy against someone else's Fish Audio quota.
const ALLOWED_ORIGINS = [
  "https://mornify.github.io",
  "http://localhost:1420",
  "http://localhost:4173",
  "http://localhost:5173",
];

// Only the endpoints the reader actually needs.
const ALLOWED_PATHS = new Set([
  "/v1/tts",
  "/v1/tts/stream/with-timestamp",
  "/model",
]);

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, model",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// Only the operator's own Pages previews. The earlier pattern was
// /^https:\/\/[a-z0-9-]+\.pages\.dev$/ — which matches ANY pages.dev subdomain,
// so anyone could deploy a site to Cloudflare Pages and use this relay as their
// own free proxy. Pages preview URLs are <hash>.<project>.pages.dev, so pinning
// the project name is what actually restricts it.
const PAGES_PREVIEW = /^https:\/\/(?:[a-z0-9-]+\.)?fish-reader\.pages\.dev$/;

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return PAGES_PREVIEW.test(origin);
}

// A narration request is a sentence or a short passage. Anything far larger is
// either a bug or someone trying to burn the relay's CPU budget, and refusing
// it early costs nothing.
const MAX_BODY_BYTES = 128 * 1024;

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    if (!isAllowedOrigin(origin)) {
      return new Response("Origin not allowed", { status: 403 });
    }

    // Preflight — the whole reason this Worker exists.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (!ALLOWED_PATHS.has(url.pathname)) {
      return new Response("Not found", { status: 404, headers: corsHeaders(origin) });
    }

    if (request.method !== "GET" && request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders(origin) });
    }

    const declaredLength = Number(request.headers.get("Content-Length") ?? 0);
    if (declaredLength > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ error: "Request too large" }), {
        status: 413,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    const auth = request.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "Missing Authorization" }), {
        status: 401,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // Forward verbatim. Only the headers Fish needs are passed on — nothing
    // about the visitor's browser or network is relayed.
    const forwardHeaders = new Headers();
    forwardHeaders.set("Authorization", auth);
    const contentType = request.headers.get("Content-Type");
    if (contentType) forwardHeaders.set("Content-Type", contentType);
    const model = request.headers.get("model");
    if (model) forwardHeaders.set("model", model);

    const upstream = new URL(UPSTREAM + url.pathname + url.search);

    let response;
    try {
      response = await fetch(upstream.toString(), {
        method: request.method,
        headers: forwardHeaders,
        body: request.method === "GET" ? undefined : request.body,
      });
    } catch {
      return new Response(JSON.stringify({ error: "Couldn't reach Fish Audio." }), {
        status: 502,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // Stream the body straight through — narration audio starts playing before
    // the whole clip has arrived.
    const headers = new Headers(corsHeaders(origin));
    const passthrough = ["content-type", "content-length", "transfer-encoding"];
    for (const name of passthrough) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers });
  },
};
