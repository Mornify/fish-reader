# Brief: restore the ElevenReader-style dark design (Fish Reader)

You are working on **Fish Reader**, a Tauri 2 + React + TypeScript macOS app in
this repo. It is a personal clone of ElevenLabs' **ElevenReader** web app
(elevenreader.io), reading books aloud with Fish Audio TTS while highlighting
the text karaoke-style.

**The problem:** a previous edit replaced the app's visual design with a warm
cream/coral "paper" theme (Manrope/Newsreader fonts, `#f1ece3` canvas,
`#ed765b` accent, hero "continue" card, card-grid library). The owner wants the
**original ElevenReader dark desktop design restored exactly**. This is a
**restyle-only task**: keep every current feature and behavior; change the
visual layer back per this spec.

## Hard rules

1. **Do not touch** `src-tauri/` (Rust), `src/lib/player.ts`, `src/lib/fish.ts`,
   `src/lib/sentences.ts`, `src/lib/importers.ts`, `src/lib/books.ts`,
   `src/lib/prefs.ts`, `src/types.ts` — logic stays as is.
2. Keep ALL current features: EPUB/PDF/DOCX/HTML/RTF/MD/TXT import with drag &
   drop + progress, paste import, mid-sentence pause/resume, draggable
   progress scrubber, ⚡ cached-clip indicator, bookmark toggle, voices panel +
   Saved voices page, speed select 0.5x–4x, spacebar play/pause.
3. These classNames are wired to logic — keep the names, restyle freely:
   `.sentence`, `.sentence.active`, `.sentence.read`, `.word`, `.track-hit`
   (+ `.dragging`), `.track`, `.fill`, `.thumb`, `.cache-dot` (+ `.on`),
   `.play-circle`, `.voice-chip`, `.voices-panel` (+ `.open`), `.orb`,
   `.drop-zone` (+ `.dragging`/`.busy`).
4. Fonts: body/UI = **Inter** (`@fontsource-variable/inter` is already in
   package.json — import it in `src/main.tsx`, remove Manrope/Newsreader
   imports). Font stack: `"Inter Variable", Inter, -apple-system, system-ui,
   sans-serif`. No serif fonts anywhere.
5. Dark theme only. No light/cream surfaces.

## Design tokens (the canonical ElevenReader-copy values)

```css
:root {
  --bg: #0b0b0b;            /* app background */
  --panel: #121212;          /* drawers/panels */
  --card: #1a1a1a;           /* cards, chips */
  --border: #2b2b2b;         /* hairline borders (#1d1d1d for sidebar edge) */
  --text: #f2f1ef;
  --muted: #9b9b98;
  --sentence-highlight: rgba(126, 224, 129, 0.15);  /* pale green wash */
  --word-highlight: #7ee081;                         /* green word chip */
  --read-gray: #91908b;                              /* already-read text */
}
```

- Buttons: **white pills** (`#fff` bg, `#000` text, fully rounded, 10px 18px
  padding) for primary; **dark pills** (`#191919` bg, `#303030` border,
  `#e8e6e2` text) for secondary. No coral/orange anywhere. No translateY hover
  lifts — subtle background/border shifts and a 0.97 scale on :active only.
- Radii: pills fully rounded (999px); cards/panels 12–18px; buttons never
  square.
- Page title ("Your library" → rename to just **"Library"**): 44px, weight
  500, letter-spacing -0.8px.
- macOS overlay titlebar: keep `padding-top ≈ 42px` on top bars
  (`.titlebar-pad`) and `data-tauri-drag-region`.

## Surface-by-surface spec

### Sidebar (256px, `#060606`, right border `#1d1d1d`)
- Wordmark "**Fish**Reader" (bold "Fish", regular "Reader", 19px). Remove the
  decorative book logo mark.
- "＋ Upload your content" button: transparent bg, 1px `#333` border, 12px
  radius, white text, hover `#151515`. (NOT a filled accent button.)
- Nav items: 10px radius rows, `#d5d3cf` text, active = `#1d1d1d` bg + white
  text, no accent inset bar. Keep both entries (Library, Saved voices).
- Footer: small gray line, e.g. "Powered by Fish Audio · local & private".
  Keep it minimal — no green privacy dot.

### Top bar (library)
- Centered pill search: `#151515` bg, `#2c2c2c` border, fully rounded,
  width min(560px, 60%), placeholder `#77756f`.
- Right: "+ Import" **dark pill**.

### Library page
- **Replace the card grid + hero "continue" card with ElevenReader's list
  layout** (this is how elevenreader.io/reader/library looks):
  - Vertical list, generous spacing (~44px between rows), max-width ~980px.
  - Each row: left column = title (21px, 600), author (muted), meta line
    (muted 13px: "37% · 3 hrs 8 mins"); actions row = white **"▶ Play"** pill
    (label "Continue" when progress > 0) + overflow "…" round button (keep the
    existing remove/confirm menu logic).
  - Right side: cover 140×186px, radius 8px, soft shadow, generated gradient
    background (keep current hue-based gradients but mute them to dark-friendly
    tones), title text small in the top-left of the cover.
- No "Continue listening" hero section, no quote glyphs, no eyebrow labels.
- Keep the books/words stat line if desired but style it muted and small.

### Reader (full-window takeover)
- `#0b0b0b` background. Top: round back button (38px circle `#1b1b1b`,
  border `#2f2f2f`), centered small title (15px, 600).
- Text column: max-width 680px, 19px / 1.78 line-height, color `#e9e7e3`,
  paragraphs spaced 1.35em.
- **Karaoke highlight (the most important visual in the app):**
  - `.sentence.active` → background `var(--sentence-highlight)`, 6px radius,
    `box-decoration-break: clone`.
  - `.word` → background `var(--word-highlight)`, **black text**, 5px radius.
  - `.sentence.read` → color `var(--read-gray)`.
  - `.sentence:hover` → `rgba(255,255,255,0.05)`.
  - Never dim or blur the active word; contrast is an accessibility requirement
    (owner is dyslexic — this is the core feature).

### Player bar (fixed bottom, full width)
- `rgba(10,10,10,0.92)` + `backdrop-filter: blur(20px)`, top border `#1f1f1f`.
- Progress row: elapsed left / -remaining right (11px, `#8a8886`, tabular
  numerals). Track: 3px `#262626`, white fill; grows to 5px on hover/drag;
  12px white thumb dot appears on hover/drag. Keep the ⚡ `.cache-dot`
  (lit = `#7ee081`).
- Controls center: bookmark icon · skip-back-15 · **white circle play/pause
  (54px, black glyph)** · skip-fwd-15 · rate `<select>` styled as plain text
  ("1x", 14px 600, no box).
- Left: mini cover (32×42, 4px radius) + title. Right: "Read by **{voice}**"
  dark pill chip with the gradient orb avatar.

### Voices panel (right drawer)
- 442px wide, `#111`, 1px `#2a2a2a` border, 18px radius, floats inset 12px
  from top/right, slides in from the right (transform transition ~0.28s).
- Header "Voices" 22px 600 + round ✕.
- Tabs as pills: active = white pill, inactive = dark pill.
- Rows: 38px gradient orb (play preview on click) + name (15px 600 white) +
  one-line gray description + ♥ toggle (gray `#6f6d69` → white when on) +
  white ✓ badge on the selected voice. Row hover `#191919`, selected `#1d1d1d`.
- Keep language/sort `<select>`s and "Load more" as small dark pills.

### Import modal
- Keep ALL current functionality (tabs, drag-drop zone, progress bar, format
  list, error block) — restyle to dark: modal `#151515`, border `#2c2c2c`,
  16px radius; drop-zone dashed `#333` border on `#0e0e0e`, highlight border
  on drag; fields `#0e0e0e` with `#2c2c2c` borders; primary action = white
  pill "Add to Library". Title just "Add content" — remove eyebrow copy.

### Saved voices page
- Same list styling as the voices panel rows, on the `#0b0b0b` page with the
  44px "Voices" title.

## Acceptance checklist
- [ ] App builds (`npm run build`) with zero TS errors.
- [ ] Everything is dark; no cream/coral/serif remains; Inter everywhere.
- [ ] Library is a list (not a grid), rows match the spec, delete flow works.
- [ ] Reader highlight = pale-green sentence wash + solid green word chip with
      black text; read text grays out; auto-scroll still works.
- [ ] Scrubber still drags (thumb, growing track) and ⚡ still lights on
      cached clips.
- [ ] Voices drawer slides in, previews play, ♥ and ✓ work, Load more works.
- [ ] Import modal: drag & drop an .epub and a .pdf still works end to end.
- [ ] No changes under `src-tauri/` and no changes to files listed in rule 1.
