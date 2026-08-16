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

/* --- PDF/TXT front matter: the narrator must not read the ISBN or the TOC --- */
{
  const body = [
    "THE LANTERN OF ASH",
    "A Novel in Three Parts",
    "by Hale Merrick",
    "Copyright 2026 Hale Merrick. All rights reserved.",
    "No part of this publication may be reproduced without permission.",
    "ISBN 978-0-000000-00-0",
    "Table of Contents",
    "Chapter One: The Storm",
    "Chapter Two: The Wheat Field",
    "CHAPTER ONE",
    "The storm came before the boy did. It tore the valley open and left the sky bleeding light for three days. Nobody in the village slept at all that week.",
    "CHAPTER TWO",
    "Kaien was standing where the lightning had been. He was perhaps twelve, and he was not burned, and that was the first impossible thing about him.",
  ].join("\n\n");
  const result = refine.refineSections([{ title: "", text: body }], "txt");
  check("drops the copyright block from a plain-text book", !/ISBN|All rights reserved/i.test(result.text), result.text.slice(0, 80));
  check("drops the contents listing", !/Table of Contents/i.test(result.text));
  check("keeps the actual prose", result.text.includes("storm came before the boy"));
  check(
    "a contents row never becomes a chapter",
    result.chapterTitles.join("|") === "CHAPTER ONE|CHAPTER TWO",
    result.chapterTitles.join("|"),
  );
  check(
    "chapter one points at the real heading, not the contents row",
    result.text.slice(result.chapterStarts[0], result.chapterStarts[0] + 11) === "CHAPTER ONE",
    JSON.stringify(result.text.slice(result.chapterStarts[0], result.chapterStarts[0] + 20)),
  );
  check("reports what it dropped", result.skipped.length > 0, JSON.stringify(result.skipped));
}

/* --- a book that opens straight into prose keeps every word --- */
{
  const body = [
    "CHAPTER ONE",
    "The storm came before the boy did. It tore the valley open and left the sky bleeding light for three days. Nobody in the village slept at all that week.",
    "CHAPTER TWO",
    "Kaien was standing where the lightning had been. He was perhaps twelve, and he was not burned, and that was the first impossible thing about him.",
  ].join("\n\n");
  const result = refine.refineSections([{ title: "", text: body }], "txt");
  check("no front matter means nothing is dropped", result.skipped.length === 0);
  check("first chapter still starts at zero", result.chapterStarts[0] === 0);
}

/* --- narration relay: access control ---
 * The relay carries no shared credential (every request uses the caller's own
 * Fish Audio key), so these guard its request budget rather than any secret.
 * The pages.dev case is a real hole that shipped: the pattern matched ANY
 * pages.dev subdomain, so anyone could deploy a site there and use the relay.  */
{
  const worker = await load("worker/index.js");
  const hit = (origin, { method = "POST", path: p = "/v1/tts", auth = "Bearer k", length } = {}) => {
    const headers = { Origin: origin };
    if (auth) headers.Authorization = auth;
    if (length) headers["Content-Length"] = String(length);
    return worker.default.fetch(
      new Request(`https://relay.test${p}`, {
        method,
        headers,
        body: method === "GET" ? undefined : "x",
      }),
    );
  };
  // 403 means rejected at the gate; anything else means it reached the forward
  // step (which fails offline with 502 — that still proves the gate let it in)
  check("relay accepts the app's own origin", (await hit("https://mornify.github.io")).status !== 403);
  check("relay rejects an unrelated site", (await hit("https://evil.com")).status === 403);
  check("relay rejects a request with no Origin", (await hit("")).status === 403);
  check(
    "relay rejects someone else's pages.dev site",
    (await hit("https://evil-site.pages.dev")).status === 403,
  );
  check(
    "relay still allows the operator's own pages preview",
    (await hit("https://abc123.fish-reader.pages.dev")).status !== 403,
  );
  check("relay rejects an oversized body", (await hit("https://mornify.github.io", { length: 200 * 1024 })).status === 413);
  check("relay rejects methods it does not need", (await hit("https://mornify.github.io", { method: "DELETE" })).status === 405);
  check("relay rejects unlisted paths", (await hit("https://mornify.github.io", { path: "/v1/admin" })).status === 404);
  check("relay rejects a request with no key", (await hit("https://mornify.github.io", { auth: null })).status === 401);
}


/* --- the deployed relay must be reachable at every path depth ---
 * Vercel's zero-config catch-all only matched ONE segment, so /api/model
 * worked while /api/v1/tts returned the platform's NOT_FOUND page and
 * narration was impossible on the deployed site. vercel.json rewrites all
 * depths to one function and passes the real path as ?path=; the pathname
 * fallback keeps the local relay working.  */
{
  const relay = await import(new URL("../api/relay.js", import.meta.url).href);
  const hit = (url) =>
    relay.default(
      new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "x" }),
    );
  const status = async (url) => (await hit(url)).status;

  // 401 = reached the handler and was rejected for a missing key, which is the
  // proof that routing worked. 404 = rejected as an unlisted path.
  check("relay routes a rewritten nested TTS path", (await status("https://x/api/relay?path=/v1/tts")) === 401);
  check(
    "relay routes the rewritten timestamped stream",
    (await status("https://x/api/relay?path=/v1/tts/stream/with-timestamp")) === 401,
  );
  check("relay routes the rewritten voice catalogue", (await status("https://x/api/relay?path=/model")) === 401);
  check("relay rejects a rewritten unlisted path", (await status("https://x/api/relay?path=/v1/admin")) === 404);
  // local development has no rewrite, so the real pathname must still work
  check("relay still routes a plain nested pathname", (await status("https://x/api/v1/tts")) === 401);
  check("relay rejects a plain unlisted pathname", (await status("https://x/api/v1/admin")) === 404);

  const config = JSON.parse(
    (await import("node:fs")).readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
  );
  check(
    "vercel.json keeps the rewrite that makes nested paths reachable",
    config.rewrites?.some((r) => r.source === "/api/(.*)" && r.destination.startsWith("/api/relay")),
    JSON.stringify(config.rewrites),
  );
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

  // a merge across a blank line would make the reader render a paragraph twice
  const acrossParagraphs = sentences.splitSentences("He met Dr.\n\nThe next morning was cold.");
  check(
    "never merges across a paragraph break",
    acrossParagraphs.length === 2,
    JSON.stringify(acrossParagraphs.map((p) => p.text)),
  );
  check(
    "offsets stay inside their own paragraph",
    acrossParagraphs[1].start > "He met Dr.".length,
    JSON.stringify(acrossParagraphs),
  );
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
