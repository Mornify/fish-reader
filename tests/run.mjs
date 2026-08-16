/**
 * Regression tests for the pure logic that shapes what users hear and see.
 * Run with `npm test`. No framework — esbuild bundles each module and we
 * assert against it, so this stays fast and dependency-free.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fish-tests-"));

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function load(relPath) {
  const outfile = path.join(tmp, path.basename(relPath).replace(/\.ts$/, ".mjs"));
  await build({
    entryPoints: [path.join(root, relPath)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    logLevel: "silent",
  });
  return import(outfile);
}

/* ---------------------------------------------------------------- */

const refine = await load("src/lib/refine.ts");
const expressive = await load("src/lib/expressive.ts");
const sentences = await load("src/lib/sentences.ts");

/* --- book refinement: junk skipping --- */
{
  const result = refine.refineSections(
    [
      { title: "Cover", text: "THE STORM" },
      {
        title: "Copyright",
        text: "Copyright © 2024 A. Writer. All rights reserved. ISBN 978-1. No part of this book may be reproduced.",
      },
      { title: "Contents", text: "Prologue\nChapter 1\nChapter 2\nChapter 3\nEpilogue\nIndex" },
      { title: "Chapter 1", text: "Kaien woke to the smell of rain.[1] He did not complain." },
      { title: "About the Author", text: "A. Writer lives in Greece." },
    ],
    "epub",
  );
  check("skips front and back matter", result.chapterTitles.length === 1, JSON.stringify(result.chapterTitles));
  check("keeps the real chapter", result.chapterTitles[0] === "Chapter 1");
  check("reports what was skipped", result.skipped.length === 4);
  check("strips footnote markers", !result.text.includes("[1]"));
  check("never returns empty text", result.text.trim().length > 0);
}

/* --- never drop everything, even if every section looks like junk --- */
{
  const result = refine.refineSections([{ title: "Cover", text: "THE STORM" }], "epub");
  check("keeps content when all sections look like junk", result.text.trim().length > 0);
}

/* --- PDF repair --- */
{
  const pages = [
    "THE STORM • A. WRITER\nPROLOGUE\nThe storm came before the boy did. It tore the valley wide open and left the whole sky bleed-\ning light for three long days and nights.\n3",
    "THE STORM • A. WRITER\nNobody in the village slept that week. They watched the ridge and waited for the light to fade, and when it finally\n4",
    "THE STORM • A. WRITER\nfaded, the boy was standing alone in the wheat field.\nCHAPTER ONE\nKaien woke early to the smell of rain on stone. His hands ached the way they always did before thunder.\n5",
    "THE STORM • A. WRITER\nHe never complained about the weather, not once in all the years the village remembered him.\n6",
  ].map((text, i) => ({ title: `Page ${i + 1}`, text }));
  const result = refine.refineSections(pages, "pdf");
  check("removes repeated running headers", !result.text.includes("A. WRITER"));
  check("removes page-number lines", !/^\s*[3-6]\s*$/m.test(result.text));
  check("rejoins hyphenated line breaks", result.text.includes("bleeding light"));
  check("stitches sentences across pages", result.text.includes("finally faded"));
  check("detects real chapters", result.chapterTitles.join("|") === "PROLOGUE|CHAPTER ONE", result.chapterTitles.join("|"));
  check("chapter offsets point at their heading", result.text.slice(result.chapterStarts[1], result.chapterStarts[1] + 11) === "CHAPTER ONE");
}

/* --- expressive narration: only tags real dialogue cues --- */
{
  const tag = expressive.autoTag;
  check("tags a whispered line", tag('"Come closer," she whispered.').startsWith("[whispering]"));
  check("tags shouting with emotion", tag('"Get out!" he shouted angrily.').startsWith("[shouting]"));
  check("leaves plain narration alone", tag("He lived at the edge of the valley.") === "He lived at the edge of the valley.");
  check("apostrophes are not dialogue", tag("He didn't train his body.") === "He didn't train his body.");
  check("counts only taggable lines", expressive.countTaggable([
    '"Run!" she screamed.',
    "The valley was quiet.",
  ]) === 1);
}

/* --- sentence splitting --- */
{
  const parts = sentences.splitSentences("First one. Second one! Third?");
  check("splits on terminal punctuation", parts.length === 3, JSON.stringify(parts.map((p) => p.text)));
  check("offsets map back to the source", "First one. Second one! Third?".slice(parts[1].start, parts[1].end) === "Second one!");
  const abbrev = sentences.splitSentences("Dr. Smith went home. He slept.");
  check("does not split on abbreviations", abbrev.length === 2, JSON.stringify(abbrev.map((p) => p.text)));
  const initials = sentences.splitSentences("She read J. R. R. Tolkien. Then she slept.");
  check("does not split on initials", initials.length === 2, JSON.stringify(initials.map((p) => p.text)));
  const pronounI = sentences.splitSentences("So do I. He agreed too.");
  check("still splits after the word I", pronounI.length === 2, JSON.stringify(pronounI.map((p) => p.text)));
  const authorInitial = sentences.splitSentences("A. Writer lives here. He is calm.");
  check("keeps a leading author initial attached", authorInitial.length === 2, JSON.stringify(authorInitial.map((p) => p.text)));
  const long = sentences.splitSentences("word ".repeat(300));
  check("splits over-long text for TTS limits", long.every((s) => s.text.length <= 400));
}

/* ---------------------------------------------------------------- */

fs.rmSync(tmp, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} failing:\n`);
  for (const failure of failures) console.error("  • " + failure);
  process.exit(1);
}
console.log(`✓ ${passed} checks passed`);
