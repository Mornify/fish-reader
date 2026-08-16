/**
 * Platform abstraction. The reader UI is identical on the web and in the macOS
 * app; only where data lives and how the network is reached differs.
 *
 *   desktop → Rust backend over Tauri IPC (files on disk, native HTTP)
 *   web     → IndexedDB + fetch, with a relay for narration
 *
 * VERIFIED FACTS this design is built on (tested against api.fish.audio):
 *   • GET /model serves CORS headers, so voice browsing works straight from
 *     the browser with no server involved.
 *   • The TTS endpoints answer a CORS preflight with 401 and no CORS headers,
 *     so narration MUST go through a relay. See worker/index.js.
 */
import type { TtsClip, TtsSegment, VoicePage, VoiceQuery } from "./fish";
import * as store from "./webstore";

export const isDesktop = (): boolean => "__TAURI_INTERNALS__" in window;

/** Relay base URL.
 *
 *  Production is same-origin `/api`, served by the Vercel function in
 *  `api/[...path].js`. Same-origin means the browser sends no preflight and
 *  there is no second DNS lookup or TLS handshake before the first syllable of
 *  audio — it also means the relay has no cross-origin surface to secure at all.
 *
 *  `npm run relay` runs the same logic on :8787 for local development. */
export const RELAY_BASE: string =
  (import.meta.env?.VITE_RELAY_URL as string | undefined) ??
  (location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "http://localhost:8787"
    : "/api");

const FISH_API = "https://api.fish.audio";
const KEY_STORAGE = "fish-api-key";

/* ------------------------------------------------------------------ *
 * Account
 * ------------------------------------------------------------------ */

export function webApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE)?.trim() ?? "";
  } catch {
    return "";
  }
}

export async function webValidateAndStoreKey(key: string): Promise<void> {
  const clean = key.trim();
  if (!clean) throw new Error("Paste your Fish Audio API key to continue.");

  let response: Response;
  try {
    // `self=true` is required: plain /model is public and answers 200 with no
    // key at all, so it would happily "validate" any string the user pastes.
    response = await fetch(`${FISH_API}/model?page_size=1&self=true`, {
      headers: { Authorization: `Bearer ${clean}` },
    });
  } catch {
    throw new Error("Couldn't reach Fish Audio. Check your internet connection.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("That key wasn't accepted. Make sure you copied the whole key.");
  }
  if (response.status === 429) {
    throw new Error("Fish Audio is rate limiting this key. Try again in a moment.");
  }
  if (!response.ok) {
    throw new Error(`Fish Audio returned an unexpected error (${response.status}).`);
  }
  localStorage.setItem(KEY_STORAGE, clean);
  // now that the user has committed, ask the browser not to evict their library
  void store.requestPersistence();
}

export function webClearKey(): void {
  try {
    localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* nothing to clear */
  }
}

/* ------------------------------------------------------------------ *
 * Voices — no relay needed, Fish allows browser access here
 * ------------------------------------------------------------------ */

export async function webListVoices(query: VoiceQuery): Promise<VoicePage> {
  const key = webApiKey();
  if (!key) throw new Error("NO_API_KEY");

  const params = new URLSearchParams();
  params.set("page_size", String(query.pageSize ?? 24));
  params.set("page_number", String(query.pageNumber ?? 1));
  if (query.title) params.set("title", query.title);
  if (query.language) params.set("language", query.language);
  if (query.sortBy) params.set("sort_by", query.sortBy);
  if (query.selfOnly) params.set("self", "true");
  for (const tag of query.tags ?? []) if (tag) params.append("tag", tag);

  let response: Response;
  try {
    response = await fetch(`${FISH_API}/model?${params}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch {
    throw new Error("Couldn't reach Fish Audio. Check your connection.");
  }
  if (response.status === 401 || response.status === 403) throw new Error("NO_API_KEY");
  if (!response.ok) throw new Error(`Fish Audio couldn't load voices (error ${response.status}).`);
  return (await response.json()) as VoicePage;
}

/* ------------------------------------------------------------------ *
 * Narration
 * ------------------------------------------------------------------ */

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Parse Fish's timestamped SSE stream: base64 audio chunks plus the newest
 *  cumulative word-alignment snapshot per chunk. Mirrors the Rust parser. */
function parseTimestampSse(raw: string): { audio: Uint8Array; segments: TtsSegment[] } {
  const parts: Uint8Array[] = [];
  const aligns = new Map<number, { offset: number; segments: TtsSegment[] }>();

  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line.slice(5).trim());
    } catch {
      continue;
    }
    const b64 = event.audio_base64;
    if (typeof b64 === "string" && b64) {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      parts.push(bytes);
    }
    const seq = typeof event.chunk_seq === "number" ? event.chunk_seq : 0;
    const offset =
      typeof event.chunk_audio_offset_sec === "number" ? event.chunk_audio_offset_sec : 0;
    const alignment = event.alignment as { segments?: TtsSegment[] } | null | undefined;
    if (alignment?.segments) aligns.set(seq, { offset, segments: alignment.segments });
  }

  const total = parts.reduce((n, p) => n + p.length, 0);
  const audio = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    audio.set(part, at);
    at += part.length;
  }

  const segments: TtsSegment[] = [];
  for (const seq of [...aligns.keys()].sort((a, b) => a - b)) {
    const entry = aligns.get(seq)!;
    for (const s of entry.segments) {
      if (typeof s?.text === "string" && typeof s.start === "number" && typeof s.end === "number") {
        segments.push({ text: s.text, start: s.start + entry.offset, end: s.end + entry.offset });
      }
    }
  }
  return { audio, segments };
}

const objectUrls = new Map<string, string>();

function urlFor(key: string, blob: Blob): string {
  const existing = objectUrls.get(key);
  if (existing) return existing;
  const url = URL.createObjectURL(blob);
  objectUrls.set(key, url);
  return url;
}

export async function webTts(text: string, voiceId: string, model: string): Promise<TtsClip> {
  const key = webApiKey();
  if (!key) throw new Error("NO_API_KEY");

  const cacheKey = await sha256Hex(`${model}${voiceId}${text}`);
  const cached = await store.getClip(cacheKey).catch(() => undefined);
  if (cached) {
    return { path: urlFor(cacheKey, cached.blob), cached: true, segments: cached.segments };
  }

  const body = JSON.stringify({
    text,
    reference_id: voiceId,
    format: "mp3",
    mp3_bitrate: 128,
    normalize: true,
    latency: "normal",
    chunk_length: 200,
  });
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    model,
  };

  let audio: Uint8Array | null = null;
  let segments: TtsSegment[] = [];

  // preferred: word-level timings for the highlight
  try {
    const response = await fetch(`${RELAY_BASE}/v1/tts/stream/with-timestamp`, {
      method: "POST",
      headers,
      body,
    });
    if (response.status === 401 || response.status === 403) throw new Error("NO_API_KEY");
    if (response.ok) {
      const parsed = parseTimestampSse(await response.text());
      if (parsed.audio.length > 0) {
        audio = parsed.audio;
        segments = parsed.segments;
      }
    }
  } catch (error) {
    if (String(error).includes("NO_API_KEY")) throw error;
    /* fall through to the plain endpoint, which reports the real failure */
  }

  // fallback: plain audio, timings estimated client-side
  if (!audio) {
    let response: Response;
    try {
      response = await fetch(`${RELAY_BASE}/v1/tts`, { method: "POST", headers, body });
    } catch {
      // Being precise matters: "check your connection" is wrong and confusing
      // when the user is plainly online and it is the relay that is down.
      throw new Error(
        navigator.onLine
          ? "The narration service isn't responding right now. Please try again shortly."
          : "You're offline. Narration needs a connection the first time a passage is read.",
      );
    }
    if (response.status === 401 || response.status === 403) throw new Error("NO_API_KEY");
    if (response.status === 429) {
      throw new Error("Fish Audio is rate limiting your account. Try again shortly.");
    }
    if (response.status === 402) throw new Error("Your Fish Audio account is out of credit.");
    if (!response.ok) throw new Error(`Narration failed (error ${response.status}). Try again.`);
    audio = new Uint8Array(await response.arrayBuffer());
    segments = [];
  }

  if (!audio || audio.length === 0) throw new Error("The narration service returned no audio.");

  const blob = new Blob([audio], { type: "audio/mpeg" });
  await store.putClip(cacheKey, { blob, segments }).catch(() => {});
  return { path: urlFor(cacheKey, blob), cached: false, segments };
}

/* ------------------------------------------------------------------ *
 * Library + cache
 * ------------------------------------------------------------------ */

export const webSaveBook = (id: string, data: string) => store.putBook(id, JSON.parse(data));
export const webListBooks = () => store.allBooks();
export const webDeleteBook = (id: string) => store.removeBook(id);
export const webCacheInfo = () => store.cacheStats();
export const webClearCache = () => store.clearClips();
