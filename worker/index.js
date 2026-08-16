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

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // allow the operator's own preview deployments
  return /^https:\/\/[a-z0-9-]+\.pages\.dev$/.test(origin);
}

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
