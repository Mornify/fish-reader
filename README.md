# Fish Reader

A private macOS read-aloud app powered by Fish Audio. Import a book or document,
choose a narrator, and follow the sentence and word highlighting as it reads.
Books, progress, bookmarks, voice preferences, and generated audio stay on this
Mac.

## What works

- EPUB import with title, author, reading order, and chapter metadata
- Text extraction from PDF and DOCX
- HTML, RTF, Markdown, plain-text, and pasted-text import
- Drag-and-drop file importing with progress and useful errors
- Per-sentence Fish Audio synthesis with a local content-addressed audio cache
- Word timing when Fish alignment is available, with a local timing fallback
- Play/pause, 15-second seeking, timeline scrubbing, and 0.5–4x speed
- Reading progress, adjustable text size, and toggleable bookmarks
- Searchable library with safe book removal
- Recent, saved, explored, and user-created voice collections
- Persistent default narrator and per-book narrator selection
- Persistent playback session: narration keeps playing outside the reader,
  with a mini player on the Library and Voices pages
- Chapters & bookmarks drawer in the reader (real EPUB chapter jumps)
- macOS media keys / AirPods controls via MediaSession
- Sleep timer (15/30/45/60 min), dyslexia-friendly font toggle (OpenDyslexic)
- One-at-a-time voice previews that stop when you leave the page
- Automatic one-shot retry when a sentence fails to synthesize
- Keyboard: Space play/pause, ←/→ skip 15s

Scanned/image-only PDFs need OCR before they contain text Fish Reader can read.

## Install

Download the latest build from the
[landing page](https://mornify.github.io/fish-reader/) or the
[releases page](https://github.com/Mornify/fish-reader/releases/latest), unzip,
and drag **Fish Reader** to Applications. On first launch, right-click the app
and choose Open (the build isn't notarized by Apple yet).

The app walks you through connecting a Fish Audio API key on first run, then
updates itself whenever a new version is published.

## Run locally

1. Copy `.env.example` to `.env`.
2. Add your Fish Audio API key as `FISH_API_KEY`.
3. Install dependencies with `npm install`.
4. Run the native app with `npm run tauri dev`.

The key is read by the Rust backend and is never sent to the frontend.

## Build the Mac app

```sh
npm run build:mac
```

The app bundle is written to:

`src-tauri/target/release/bundle/macos/Fish Reader.app`

Local builds are ad-hoc signed. Public distribution still requires an Apple
Developer ID signature and notarization.

## Project notes

- [docs/design-spec.md](docs/design-spec.md) — original interaction and highlight reference
- [docs/fish-audio-api.md](docs/fish-audio-api.md) — Fish Audio endpoints and caching plan
- `src-tauri/icons/app-icon-master.png` — generated master for the app icon bundle

## Commands

- `npm test` — regression suite for import refinement, sentence splitting and
  expressive narration
- `npm run release <version>` — signed build + GitHub release (auto-update feed)
- `npm run dev` — frontend-only preview
- `npm run build` — TypeScript and production frontend build
- `npm run tauri dev` — native development app
- `npm run build:mac` — release macOS bundle with a verified local signature
- `cargo check --manifest-path src-tauri/Cargo.toml` — Rust backend check

## Releasing

Two platforms, released from two machines, because neither can build the other:
Tauri cannot cross-compile Windows from macOS (it needs the MSVC toolchain and
WebView2), and a macOS bundle needs a local re-signing step that a Windows box
cannot do.

**macOS** — from the Mac:

```sh
npm run release 0.2.3
```

Bumps the version everywhere, builds, signs the updater artifact, refuses to
continue if the build contains a credential, re-signs the app (Tauri's default
ad-hoc signature fails verification, which makes macOS call a downloaded copy
"damaged"), then publishes the GitHub release and writes `latest.json`.

**Windows** — afterwards, from a Windows PC, to *attach* to that same release:

```powershell
git checkout v0.2.3
powershell -ExecutionPolicy Bypass -File scripts\release-windows.ps1 -Version 0.2.3
```

Prerequisites and the reasoning are in the script's header. It refuses to run if
the checked-out version doesn't match the tag, and it *merges* into
`latest.json` rather than replacing it — writing that file from one platform
would delete the other's entry and silently stop those users updating.

The Windows installer is **unsigned** (no code-signing certificate), so
SmartScreen warns on first run. macOS builds are ad-hoc signed and not
notarized, so a downloaded copy needs right-click → Open once.
