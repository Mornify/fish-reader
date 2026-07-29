# ElevenReader design spec (scraped 2026-07-28)

Sources: elevenreader.io landing page (live CSS inspection), official App Store
screenshot set (8 shots, viewed at 600×1300), marketing sections.

## Design tokens (verified via live CSS on elevenreader.io)

| Token | Value |
|---|---|
| Body font | `Inter` |
| Display font | `Waldenburg` (ElevenLabs' licensed brand font — needs a free substitute) |
| Page background (light) | `rgb(253, 252, 252)` `#FDFCFC` |
| Text | `#000` |
| Base radius | `8px` (buttons/inputs), ~24–28px large cards, fully-rounded pills |
| Dark mode bg | near-black ~`#0D0D0D`, chips/cards ~`#1C1C1E`–`#2C2C2E` |
| Brand accent (marketing) | periwinkle purple ~`#8B7FF0` |
| H1 scale (web) | 60px, weight 400, Waldenburg |

Display font substitute candidates (Waldenburg is a clean neo-grotesk):
**Schibsted Grotesk**, Instrument Sans, or just Inter Display at -2% tracking.

### Reading-highlight palette (the signature look)
- Current **sentence**: soft pale-green wash, ~`#E4F7D4`, rounded corners per line
- Current **word**: saturated green rounded rect, ~`#7EE081`, black text
- Already-read text: faded gray ~`#9E9E9E`
- Unread text: near-black
- Reader text: Inter, ~17–18px equivalent, generous line-height (~1.6), left-aligned

## Screen catalog (from App Store shots)

### 1. Reader + player (core screen)
- Clean text page on white card; back chevron in circle (top-left), `…` overflow (top-right)
- Title (e.g. "The Duke's Secret") ~22px semibold, "Chapter 1" section label
- Sentence/word highlight as above; floating black circular button on right text edge (feedback/AI)
- **Progress bar**: hairline black bar on light-gray track; elapsed left ("22:51"), remaining right ("7:46")
- **Transport row**: sleep-timer (moon) · skip-back 15 (circled-arrow "15") · big black **borderless** pause/play glyph (no circle around it) · skip-fwd 30 · speed label "1x"
- **Bottom row**: volume icon · center pill chip = voice avatar + name ("Christopher") → opens voice picker · queue/list icon
- Player sits on a white sheet with very large top radius over pale-gray page

### 2. Speed sheet
- White rounded card: "Reading speed: 2x" (bold), black slider w/ dot handle
- Tick labels: `0.5x · 1x · 2x · 3x · 4x` → speed range **0.5–4x**

### 3. Sleep timer
- Black pillow-shaped "Sleep Timer" button; "End in.. " + `45 min ⌄` dropdown chip

### 4. Bookmarks
- "✔ Bookmark Saved" pale-gray pill toast, top-center

### 5. Voice picker
- Voice = pill card: mesh-gradient orb avatar (colorful blurred circle) + name (semibold) + heart (favorite)
- Rows of pills in a loose grid ("Chris, Matilda, Will, Bella, Bryan, Georges, River, Sarah…")
- "Iconic voices": photo cards, tilted stack, white name pill at bottom (Feynman, Einstein, M. Caine)

### 6. Explore / store (dark mode shot)
- Huge "Explore" title (white, ~34pt), circular dark search button top-right
- Filter icon + genre chips (dark-gray pills: "Dystopian", "Billionaire", "Healing")
- "What's trending" + gray subtitle
- 2-col genre cards: flat pastel rounded squares (orange/green/indigo/pink) with photos
  masked inside novelty shapes (heart = Romance, clover = Fantasy, scalloped circle = Sci-Fi)
- White label + "N,000+ Books" inside each card

### 7. Book detail
- Circular back + share buttons, centered large cover (rounded ~12px, soft shadow)
- Title (semibold, centered), "By Hill, Napoleon" (gray), "Free" tag
- Full-width white pill CTA: 🎧 "Listen now"

### 8. Soundscapes sheet (ambient audio under narration)
- "Soundscapes" title + X close
- Category pills: All / **Focus** (active = black pill, white text) / Sleep / Story / Nature
- Rows: circular artwork + name ("Alpha Wave Focus") + black ✓ badge when selected
- Bottom: black "🔊 Soundscape" pill + gray volume slider track

### 9. Add content (import) — partial view from hero shot
- "Add content" popover, icon rows: link (URL), scan (camera), text (paste), `+` (files)
- Landing page tabs confirm import types: **PDFs · URLs · Docs · Texts** (+ EPUB per store copy)
- Home library has sections; audiobook rows: "Top Picks", "Just for you", "Bestsellers"

## Desktop web app (from owner's logged-in elevenreader.io screenshots, 2026-07-28)

This is the primary reference for our macOS app. All dark theme.

- **Shell**: left sidebar (~300px, near-black): wordmark top; "＋ Upload your
  content" outlined rounded button; nav Explore / Library; Collections (+),
  Read Later; footer links. Top bar: centered pill search, "+ Import" pill,
  account avatar.
- **Library page**: huge light "Library" title (~44px); filter row (All titles ⌄,
  Read Later, + Create a collection · right: Sort by, Filter library); big list
  rows = title (20px semibold) / subtitle / "3 hrs 8 mins" duration + progress
  ring, white "▶ Play" pill + "★ Rate" + "…" — cover thumbnail far right.
- **Reader**: full-window takeover. Top: back chevron, centered small title,
  "…" right. Left panel "Chapters" list (active = dark rounded row). Bottom
  player bar: mini cover + title left; center bookmark · −15 · big WHITE
  circular play/pause · +15 · 1x; right "Read by <Voice>" chip; hairline
  progress on top with elapsed left / −remaining right.
- **Voices panel**: right-side rounded drawer: "Voices" + ✕; pill tabs Recent /
  Favorites / Explore / Created (active = white pill); "Create new voice" row;
  sections ("Recent voices"); rows = circular avatar, bold name + gray subtitle,
  ♥ toggle (filled when favorited), ✓ on the selected voice.
- Implemented in-app 2026-07-28 (v1 skips: Explore store, Collections,
  Read Later, account menu). Owner's accessibility requirement (ADHD/dyslexia):
  caption-style emphasis while reading — sentence wash + strong word chip,
  auto-centered scroll. Non-negotiable core feature.
