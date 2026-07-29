# Brief for Codex: polish pass (animations + generated artwork ONLY)

You are polishing **Fish Reader**, a finished Tauri 2 + React + TS macOS app in
this repo. The design is a deliberate ElevenReader-style dark theme and the
feature set is complete and working. Your job is strictly **motion and
artwork** — you are not redesigning anything.

## Hard rules (these exist because a previous pass broke the design)

1. **Do not change** colors, fonts, spacing, layout, or any design token in
   `src/App.css` `:root`. The dark theme (#0b0b0b bg, white pills, green
   highlights #7ee081, Inter font) is final.
2. **Do not touch** `src-tauri/**` or anything in `src/lib/**` (player,
   session, importers, fish API, preview, prefs, sentences). No new npm
   dependencies. No animation libraries — CSS transitions/keyframes only.
3. Do not rename or remove any existing className. You may ADD classes and
   keyframes.
4. Every animation must respect `@media (prefers-reduced-motion: reduce)` —
   wrap all of it so it collapses to no motion.
5. The karaoke highlight is an accessibility feature (owner is dyslexic).
   The `.word` chip must keep tracking words EXACTLY in sync — you may soften
   its movement with a ≤80ms transition on background/opacity, but NEVER add
   transforms/delays that make it lag the audio, and never animate layout
   properties on `.sentence`/`.word` (no font-size/weight/padding changes).
6. All artwork must be LOCAL bundled assets (`src/assets/`), dark-theme
   palette (#0b0b0b–#1a1a1a range, muted tones, the green #7ee081 as the only
   accent). No runtime network fetches.
7. Acceptance: `npm run build` passes with zero TS errors; the app looks
   identical when `prefers-reduced-motion` is on.

## Animation tasks (CSS only, transform/opacity — never layout)

1. **View transitions**: Library → Reader and back — a fast fade+4px rise on
   the incoming view (~180ms ease-out). No route lib; add a mount class on
   `.reader` / `.main-col`.
2. **Mini player entrance**: `.mini-player` slides up + fades in when it
   appears (~220ms, cubic-bezier(0.32, 0.72, 0, 1)), reverse on close.
3. **Modal & drawers**: `.overlay` fade (~150ms) with `.modal` scale
   0.97→1; `.reader-drawer` and `.voices-panel` already slide — add a soft
   fade on their scrims and a 20ms stagger on `.voice-row` items when a tab's
   list first renders (opacity/translateY 6px, max ~12 items staggered).
4. **Buttons**: unify micro-interactions — white pills and `.play-circle`
   already scale on :active; add a subtle 150ms background transition on
   hover states that lack one. Nothing bouncy.
5. **Toasts**: `.toast` slide-down + fade in, fade out before unmount
   (animation only — do not change the toast timing logic).
6. **Progress fill**: on the reader `.fill`, keep the existing linear width
   transition; add a faint moving sheen ONLY while `.track-hit.dragging`.
7. **Book covers**: `.book-cover:hover` — current lift is fine; add a very
   subtle 1deg tilt + shadow deepen (~200ms). Nothing on click paths.
8. **Sentence wash**: when `.sentence.active` moves to a new sentence, its
   background may fade in over ~150ms (already partially there — verify it
   feels smooth, don't slow it further).

## Artwork tasks (generate images, save under src/assets/, wire via CSS/JSX)

1. **Book-cover textures**: generate 8 abstract, grainy, dark-toned texture
   images (square, ≤512px, muted hues matching tones 0–7 hue families used in
   `.book-cover.tone-N`: warm red, olive, green, teal, blue, indigo, violet,
   rose). Layer each behind the existing gradient as
   `background-image: url(...), linear-gradient(existing)` with low opacity
   feel — the title text must stay clearly readable. Keep total added weight
   under ~600KB.
2. **Empty-state illustrations**: two small dark-theme illustrations
   (≤80KB each): an open book with a soft green highlight line for the empty
   Library, and a stylized waveform for the empty Voices page. Subtle, mostly
   monochrome with the single green accent, on transparent background. Wire
   into `.empty-state` above the heading.
3. **Welcome flourish** (optional): a soft, barely-visible dark radial
   texture for the reader background — ONLY if it stays under 5% perceived
   contrast and doesn't reduce text legibility. If in doubt, skip.

## What NOT to do, explicitly

- No light theme, no new colors, no gradients on buttons, no glassmorphism.
- No parallax, no scroll-jacking, no springy overshoot on the reading surface.
- No animation on `.reader-column` text while audio plays (except the
  existing highlight behavior).
- No changes to timings/logic in TS files other than adding classNames.
- If a task conflicts with these rules, skip it and note it in your summary.
