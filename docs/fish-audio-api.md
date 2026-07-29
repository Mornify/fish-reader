# Fish Audio API notes (verified against docs.fish.audio, 2026-07-28)

## Text-to-speech
- `POST https://api.fish.audio/v1/tts`
- Auth: `Authorization: Bearer $FISH_API_KEY`
- Model selection via **`model` HTTP header**: `s2.1-pro` (recommended, 83 langs) ·
  `s2.1-pro-free` ($0 fair-use, same model, no latency guarantees — use for dev) ·
  `s2-pro` · `s1` (legacy, 13 langs)
- Body (JSON or msgpack):
  - `text` (required)
  - `reference_id` — voice model id from the marketplace / your clones
  - `format`: `wav` | `pcm` | `mp3` | `opus`
  - `chunk_length`: 100–300 (chars per internal segment)
  - `latency`: `low` | `normal` | `balanced`
  - `normalize`: bool (stabilizes numbers/dates)
  - `prosody`: `{ speed, volume }`
  - `temperature`, `top_p` (expressiveness)
  - `sample_rate`, `mp3_bitrate` (64/128/192), `opus_bitrate`
- Response: audio bytes, **streams via `Transfer-Encoding: chunked`**
- Emotion/delivery control: bracket syntax in text, e.g. `(excited)` / `[whisper]`
  (s1 has 64+ expressions; s2.x takes free-form natural-language brackets)

## ✅ Word timestamps EXIST (undocumented endpoint, found via openapi.json)
`POST https://api.fish.audio/v1/tts/stream/with-timestamp` — same body as
/v1/tts, responds with an **SSE stream**: each `data:` event carries
`audio_base64` (concatenate in order), `chunk_seq`, `chunk_audio_offset_sec`,
and a cumulative `alignment` snapshot `{segments: [{text, start, end}], 
audio_duration}` — keep only the NEWEST snapshot per chunk_seq, offset by the
chunk's `chunk_audio_offset_sec`. Verified 2026-07-28 on `s2.1-pro-free`:
true per-word timing ("Hello 0.00–0.48, there 0.48–0.88…").

Our pipeline (src-tauri tts command):
1. Split into sentences client-side; synthesize per sentence (prefetch 3).
2. Sentence highlight exact by construction; **word highlight exact** from the
   alignment (segments matched to word spans in order, normalized compare).
3. Fallback: if the timestamp endpoint errors → plain /v1/tts + char-weight
   interpolation (also used for pre-upgrade cached clips with no .align.json).
4. Speed: client `playbackRate` (0.5–4x), instant, no re-synthesis.
5. Full spec saved: scratchpad fish-openapi.json → also exposes /v1/asr,
   /v1/voice-design, wallet endpoints.

## Voice catalog — extra params (from openapi.json)
`GET /model`: `sort_by` ∈ {score (hot), task_count (most used), created_at
(newest)}, `tag`, `author_id`, `title_language`. **No "liked voices" filter
exists in the public API** — a user's fish.audio hearts are not retrievable
with an API key; only `self=true` (voices they created). Workaround: in-app
favorites (localStorage) + `favorites-seed.json` merge mechanism in app-data.

## Voice catalog
- `GET https://api.fish.audio/model` — params: `title`, `tags`, `language`,
  `self` (own/cloned voices), `page_size`, `page_number`
- Returns `{ total, items[], has_more }`; item: `_id`, `title`, `state`,
  `visibility`, plus author/languages/samples fields
- `GET https://api.fish.audio/model/{id}` — one voice
- Maps 1:1 onto the ElevenReader voice-picker UI (search + filter + favorite)

## Realtime (later, not needed for v1)
- WebSocket streaming exists (`/features/realtime-streaming` in docs) for
  live token-by-token TTS; our per-sentence HTTP streaming is simpler and fine
  for a reader.

## Cost & caching
- Dev on `s2.1-pro-free` = $0. Paid model pricing: check dashboard (docs pages
  don't publish rates; historically ~$15/M UTF-8 bytes).
- **Cache every clip to disk** keyed by `hash(model + voice + text + params)` —
  re-listening and scrubbing back is then free and instant. A full novel
  (~300–400k chars) is only ever paid once per voice.
