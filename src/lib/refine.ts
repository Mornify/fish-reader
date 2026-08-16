/**
 * The book-refinement algorithm. Raw extraction (importers.ts) gives us text +
 * rough sections; this pass turns that into something worth narrating:
 *
 *  1. SKIP the parts nobody wants read aloud — cover/title pages, copyright,
 *     table of contents, indexes, acknowledgements — detected by section
 *     title AND by content shape (so mislabeled sections still get caught).
 *  2. REPAIR PDF text: drop repeated page headers/footers, standalone page
 *     numbers, rejoin words split by line-break hyphenation, rebuild real
 *     paragraphs from visual lines, and stitch sentences across page breaks.
 *  3. DETECT real chapters ("Chapter 3", "PART II", "Prologue", numbered or
 *     ALL-CAPS headings) so PDFs/TXT get a usable chapter list instead of
 *     "Page 1 … Page 400".
 *  4. Strip footnote markers and reference junk everywhere.
 *
 * Pure functions — no DOM, no Tauri — so they are unit-testable in node.
 */

export interface Section {
  title: string;
  text: string;
}

export interface RefineResult {
  text: string;
  chapterTitles: string[];
  chapterStarts: number[];
  /** titles of sections that were dropped, for reporting */
  skipped: string[];
}

/* ---------------- junk-section classification ---------------- */

const JUNK_TITLE = new RegExp(
  [
    "^cover$",
    "^(half[ -]?)?title ?page$",
    "^copyright",
    "^imprint$",
    "^colophon$",
    "^(table of )?contents$",
    "^toc$",
    "^index( of [a-z ]+)?$",
    "^acknowledg",
    "^about the (author|publisher|translator)",
    "^also by\\b",
    "^books by\\b",
    "^other (books|titles)\\b",
    "^praise for\\b",
    "^advertisement",
    "^newsletter",
    "^bibliography$",
    "^glossary$",
    "^landmarks$",
    "^guide$",
  ].join("|"),
  "i",
);

const COPYRIGHT_SIGNALS = [
  /©|\bcopyright\b/i,
  /all rights reserved/i,
  /\bisbn\b/i,
  /first (published|edition|printing)/i,
  /no part of this (book|publication)/i,
  /library of congress/i,
];

function looksLikeCopyright(text: string): boolean {
  if (text.length > 4000) return false;
  let hits = 0;
  for (const signal of COPYRIGHT_SIGNALS) if (signal.test(text)) hits++;
  return hits >= 2;
}

function looksLikeToc(text: string): boolean {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 6) return false;
  let tocish = 0;
  for (const line of lines) {
    const entry =
      line.length < 80 &&
      (/\b\d{1,4}$/.test(line) || // "The Storm ..... 214"
        /^(chapter|part|book|prologue|epilogue|act)\b/i.test(line) ||
        (!/[.!?…]["”']?$/.test(line) && line.length < 50));
    if (entry) tocish++;
  }
  return tocish / lines.length >= 0.7;
}

/** Decide whether a section should be skipped entirely. */
export function classifySection(section: Section): "keep" | "skip" {
  const title = section.title.trim();
  if (JUNK_TITLE.test(title)) return "skip";
  const body = section.text.trim();
  if (body.length < 80 && !/[.!?…]/.test(body)) return "skip"; // bare title/cover pages
  if (looksLikeCopyright(body)) return "skip";
  if (looksLikeToc(body)) return "skip";
  return "keep";
}

/* ---------------- text repair ---------------- */

/** Strip footnote superscripts and bracketed reference markers. */
export function stripFootnoteMarks(text: string): string {
  return text
    .replace(/[¹²³⁰-⁹⁺-⁾]+/g, "")
    .replace(/(\S)\[\d{1,3}\]/g, "$1")
    .replace(/^\s*\[\d{1,3}\]\s*/gm, "");
}

const PAGE_NUMBER_LINE = /^\s*(?:page\s+)?(?:\d{1,4}|[ivxlcdm]{1,8})\s*$/i;

function normalizeLineKey(line: string): string {
  return line.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

/**
 * PDF pages → clean continuous text.
 * Detects lines that repeat across many pages (running headers/footers) and
 * removes them, drops page-number lines, fixes hyphenation, rebuilds
 * paragraphs, and joins sentences across page boundaries.
 */
export function cleanPdfPages(pages: string[]): string {
  const pageLines = pages.map((p) => p.split("\n").map((l) => l.trim()));

  // 1. find repeated header/footer lines (top/bottom 3 lines of each page)
  const freq = new Map<string, number>();
  for (const lines of pageLines) {
    const edges = new Set([...lines.slice(0, 3), ...lines.slice(-3)]);
    for (const line of edges) {
      const key = normalizeLineKey(line);
      if (key && key.length < 70) freq.set(key, (freq.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.floor(pages.length * 0.25));
  const junkLines = new Set(
    [...freq.entries()].filter(([, n]) => n >= threshold).map(([k]) => k),
  );

  // 2. clean each page: drop junk + page-number lines
  const cleanedPages = pageLines.map((lines) =>
    lines.filter((line) => {
      if (!line) return false;
      if (PAGE_NUMBER_LINE.test(line)) return false;
      if (junkLines.has(normalizeLineKey(line))) return false;
      return true;
    }),
  );

  // 3. rebuild paragraphs per page from visual lines
  const paraPages = cleanedPages.map((lines) => rebuildParagraphs(lines));

  // 4. join pages: hyphenation + mid-sentence page breaks
  let text = "";
  for (const page of paraPages) {
    if (!page) continue;
    if (!text) {
      text = page;
      continue;
    }
    if (/\p{L}-$/u.test(text)) {
      text = text.replace(/-$/u, "") + page; // "beauti-" | "ful ..."
    } else if (!/[.!?…:"”'\)\]]$/.test(text.trimEnd()) && /^[\p{Ll}]/u.test(page)) {
      text = `${text} ${page}`; // sentence continues on next page
    } else {
      text = `${text}\n\n${page}`;
    }
  }
  return text;
}

/** Visual lines → paragraphs. A paragraph ends when a line ends with terminal
 *  punctuation, is heading-like, or is markedly short. */
export function rebuildParagraphs(lines: string[]): string {
  const lengths = lines.filter((l) => l.length > 0).map((l) => l.length);
  const median = lengths.length
    ? [...lengths].sort((a, b) => a - b)[Math.floor(lengths.length / 2)]
    : 60;

  const out: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) out.push(current.trim());
    current = "";
  };

  for (const line of lines) {
    if (!line) {
      flush();
      continue;
    }
    if (isHeadingLine(line)) {
      flush();
      out.push(line);
      continue;
    }
    // de-hyphenate within the page
    if (/\p{L}-$/u.test(current)) current = current.replace(/-$/u, "") + line;
    else current = current ? `${current} ${line}` : line;

    const terminal = /[.!?…]["”']?$/.test(line);
    const short = line.length < Math.max(35, median * 0.55);
    if (terminal && short) flush();
    else if (terminal && /^["“'A-Z0-9]/.test(line)) {
      // full-width terminal line — likely a real paragraph end
      flush();
    }
  }
  flush();
  return out.join("\n\n");
}

/* ---------------- chapter detection ---------------- */

const CHAPTER_WORD =
  /^(chapter|part|book|prologue|epilogue|interlude|introduction|foreword|preface|afterword|act|scene|appendix)\b/i;
const NUMBERED_HEADING = /^(?:[IVXLCDM]{1,8}|\d{1,3})[.)]?$/;

export function isHeadingLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 60) return false;
  if (/[.!?…,;:]["”']?$/.test(t) && !/^\d{1,3}\.$/.test(t)) return false;
  if (CHAPTER_WORD.test(t)) return true;
  if (NUMBERED_HEADING.test(t)) return true;
  // short ALL-CAPS line with at least two letters ("THE ASHEN VALLEY")
  const letters = t.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 3 && t.length <= 48 && letters === letters.toUpperCase()) return true;
  return false;
}

/** Find chapter boundaries in continuous text. Returns [] when the text
 *  doesn't have believable chapters. */
export function detectChapters(text: string): { title: string; start: number }[] {
  const found: { title: string; start: number }[] = [];
  const re = /^.{1,60}$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const line = match[0].trim();
    if (!line) continue;
    // isHeadingLine also rejects lines ending in sentence punctuation, so a
    // hard-wrapped prose line that happens to start with "Part"/"Book" can no
    // longer masquerade as a chapter
    if (isHeadingLine(line) && (CHAPTER_WORD.test(line) || NUMBERED_HEADING.test(line.replace(/\s+/g, " ")))) {
      found.push({ title: line.replace(/\s+/g, " "), start: match.index });
    }
  }
  // What separates a real chapter heading from a table-of-contents row is what
  // FOLLOWS it: a chapter is followed by prose, a contents row by another row.
  // The previous rule measured the distance to the neighbouring heading and
  // unconditionally kept found[0]. In a book whose contents listing sits near
  // the top, that kept the row "Chapter One: The Storm" as chapter one and then
  // discarded the real "CHAPTER ONE" heading just after it for being too close
  // — so clicking chapter one jumped into the table of contents.
  if (found.length < 2) return [];
  const MIN_BODY = 120;
  const spaced = found.filter((c, i) => {
    const next = i + 1 < found.length ? found[i + 1].start : text.length;
    const body = text.slice(c.start + c.title.length, next).replace(/\s+/g, " ").trim();
    return body.length >= MIN_BODY;
  });
  return spaced.length >= 2 ? spaced : [];
}

/**
 * Drop the title page / copyright block / contents listing that sits in front
 * of chapter one.
 *
 * EPUBs arrive as named sections, so classifySection() can throw these away by
 * name. A PDF or a .txt is one continuous blob with no section names at all, so
 * none of that logic could ever fire and the narrator read the ISBN, the
 * copyright notice and every line of the table of contents before reaching the
 * first sentence of the book.
 *
 * Only the region before the first real chapter is ever considered, and only
 * when it actually looks like front matter — a book that opens straight into
 * prose, or with an untitled prologue, keeps every word.
 */
export function stripFrontMatter(
  text: string,
  chapters: { title: string; start: number }[],
): { text: string; chapters: { title: string; start: number }[]; dropped: string[] } {
  if (chapters.length === 0 || chapters[0].start <= 0) return { text, chapters, dropped: [] };

  const head = text.slice(0, chapters[0].start);
  const dropped: string[] = [];
  if (looksLikeCopyright(head)) dropped.push("Copyright");
  if (looksLikeToc(head)) dropped.push("Contents");
  if (dropped.length === 0) {
    // a bare cover/title page: a few short lines and not a real sentence
    const prose = head.replace(/\s+/g, " ").trim();
    if (prose.length > 0 && prose.length < 200 && !/[.!?…]/.test(prose)) dropped.push("Title page");
  }
  if (dropped.length === 0) return { text, chapters, dropped: [] };

  const cut = chapters[0].start;
  return {
    text: text.slice(cut),
    chapters: chapters.map((c) => ({ title: c.title, start: c.start - cut })),
    dropped,
  };
}

/* ---------------- top-level ---------------- */

export function refineSections(sections: Section[], source: string): RefineResult {
  // PDFs arrive as one pseudo-section per page — handle separately
  // a one-page PDF needs the same cleanup as a hundred-page one
  if (source === "pdf" && sections.length >= 1 && /^page \d+$/i.test(sections[0]?.title ?? "")) {
    const cleaned = stripFootnoteMarks(cleanPdfPages(sections.map((s) => s.text)));
    const found = detectChapters(cleaned);
    if (found.length > 0) {
      const front = stripFrontMatter(cleaned, found);
      return {
        text: front.text,
        chapterTitles: front.chapters.map((c) => c.title),
        chapterStarts: front.chapters.map((c) => c.start),
        skipped: front.dropped,
      };
    }
    return { text: cleaned, chapterTitles: ["Full text"], chapterStarts: [0], skipped: [] };
  }

  // EPUB & everything with named sections: classify, drop junk, reassemble
  const kept: Section[] = [];
  const skipped: string[] = [];
  for (const section of sections) {
    if (classifySection(section) === "skip") skipped.push(section.title || "Untitled section");
    else kept.push({ title: section.title, text: stripFootnoteMarks(section.text) });
  }
  const usable = kept.length > 0 ? kept : sections; // never drop everything

  // single unnamed blob (txt/docx/rtf): try to find chapters inside it
  if (usable.length === 1) {
    const body = usable[0].text;
    const found = detectChapters(body);
    if (found.length > 0) {
      // a pasted or .txt book carries its front matter inline too
      const front = stripFrontMatter(body, found);
      return {
        text: front.text,
        chapterTitles: front.chapters.map((c) => c.title),
        chapterStarts: front.chapters.map((c) => c.start),
        skipped: [...skipped, ...front.dropped],
      };
    }
  }

  let offset = 0;
  const starts: number[] = [];
  const titles: string[] = [];
  const parts: string[] = [];
  for (const section of usable) {
    starts.push(offset);
    titles.push(section.title.replace(/\s+/g, " ").trim() || `Section ${titles.length + 1}`);
    parts.push(section.text);
    offset += section.text.length + 2;
  }
  return { text: parts.join("\n\n"), chapterTitles: titles, chapterStarts: starts, skipped };
}
