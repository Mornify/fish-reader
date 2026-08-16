/**
 * Fish Reader narration relay — Vercel serverless function.
 *
 * WHY THIS EXISTS
 * api.fish.audio serves CORS headers for GET /model, so a browser can list
 * voices directly. But its TTS endpoints answer a CORS preflight with a bare
 * 401 and no CORS headers, so a browser can never POST to them. This function
 * is the minimum piece of server needed to make the web app possible.
 *
 * It runs on the same origin as the app, which is the main reason to prefer it
 * over a separate Worker: a same-origin request needs no preflight, exposes no
 * cross-origin surface, and starts streaming audio a round trip sooner.
 *
 * WHAT IT DOES NOT DO — this is a privacy promise the code has to keep:
 *   - it does not store, log, or inspect the user's API key
 *   - it does not store or log the text being narrated
 *   - it holds no database, no accounts, no analytics
 * It receives the user's own key in the Authorization header, forwards the
 * request to Fish Audio, and streams the audio straight back.
 *
 * There is no shared credential here: every request carries the caller's own
 * Fish Audio key, so nobody can spend anyone else's narration quota through it.
 */

export const config = { runtime: "edge" };

const UPSTREAM = "https://api.fish.audio";

// Only the endpoints the reader actually needs — this must never become a
// general-purpose proxy to api.fish.audio.
const ALLOWED_PATHS = new Set(["/v1/tts", "/v1/tts/stream/with-timestamp", "/model"]);

// A narration request is a sentence or a short passage. Anything far larger is
// either a bug or someone trying to burn CPU time, and refusing it costs nothing.
const MAX_BODY_BYTES = 128 * 1024;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export default async function handler(request) {
  const url = new URL(request.url);
  // /api/v1/tts → /v1/tts
  const path = url.pathname.replace(/^\/api/, "");

  if (request.method !== "GET" && request.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }
  if (!ALLOWED_PATHS.has(path)) {
    return json(404, { error: "Not found" });
  }
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY_BYTES) {
    return json(413, { error: "Request too large" });
  }

  const auth = request.headers.get("Authorization");
  if (!auth) return json(401, { error: "Missing Authorization" });

  // Forward only what Fish needs. Nothing about the visitor's browser, network
  // or referrer is passed upstream.
  const headers = new Headers();
  headers.set("Authorization", auth);
  for (const name of ["Content-Type", "model"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let response;
  try {
    response = await fetch(UPSTREAM + path + url.search, {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : request.body,
      // required by undici/edge when streaming a request body through
      duplex: "half",
    });
  } catch {
    return json(502, { error: "Couldn't reach Fish Audio." });
  }

  // Stream the body straight through, so narration starts playing before the
  // whole clip has arrived.
  const out = new Headers({ "Cache-Control": "no-store" });
  for (const name of ["content-type", "content-length"]) {
    const value = response.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers: out });
}
