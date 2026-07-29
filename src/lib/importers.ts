import { Book } from "../types";
import { makeBook } from "./books";
import { refineSections, Section } from "./refine";

export const ACCEPTED_EXTENSIONS = [
  ".epub",
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  ".markdown",
  ".html",
  ".htm",
  ".rtf",
];

export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.join(",");

export interface ImportProgress {
  label: string;
  fraction?: number;
}

interface ParsedDocument {
  title: string;
  author?: string;
  text: string;
  chapterTitles?: string[];
  chapterStarts?: number[];
}

export async function importBookFile(
  file: File,
  onProgress?: (progress: ImportProgress) => void,
): Promise<Book> {
  const extension = extensionOf(file.name);
  onProgress?.({ label: `Opening ${file.name}` });

  let parsed: ParsedDocument;
  switch (extension) {
    case "pdf":
      parsed = await parsePdf(file, onProgress);
      break;
    case "epub":
      parsed = await parseEpub(file, onProgress);
      break;
    case "docx":
      parsed = await parseDocx(file);
      break;
    case "html":
    case "htm":
      parsed = parseHtml(await file.text(), baseName(file.name));
      break;
    case "rtf":
      parsed = {
        title: baseName(file.name),
        text: parseRtf(await file.text()),
      };
      break;
    case "md":
    case "markdown":
      parsed = {
        title: baseName(file.name),
        text: markdownToText(await file.text()),
      };
      break;
    case "txt":
    default:
      if (extension && !ACCEPTED_EXTENSIONS.includes(`.${extension}`)) {
        throw new Error(
          `“${extension.toUpperCase()}” files are not supported yet. Try EPUB, PDF, DOCX, HTML, RTF, Markdown, or plain text.`,
        );
      }
      parsed = {
        title: baseName(file.name),
        text: normalizeText(await file.text()),
      };
  }

  if (!parsed.text.trim()) {
    throw new Error("No readable text was found in this file. Scanned PDFs need OCR before importing.");
  }

  // refinement pass: skip junk sections, repair PDF text, detect real chapters
  onProgress?.({ label: "Cleaning up the text…", fraction: 0.96 });
  const sections: Section[] = sectionsOf(parsed);
  const refined = refineSections(sections, extension || "txt");

  if (!refined.text.trim()) {
    throw new Error("No readable text was found in this file. Scanned PDFs need OCR before importing.");
  }

  const book = makeBook(parsed.title || baseName(file.name), refined.text, parsed.author);
  book.sourceType = extension ? extension.toUpperCase() : "TEXT";
  book.fileName = file.name;
  book.chapterStarts = refined.chapterStarts;
  book.chapterTitles = refined.chapterTitles;
  if (refined.skipped.length > 0) book.skippedSections = refined.skipped;
  onProgress?.({
    label:
      refined.skipped.length > 0
        ? `Ready — skipped ${refined.skipped.length} extra${refined.skipped.length === 1 ? "" : "s"} (${refined.skipped.slice(0, 3).join(", ")}${refined.skipped.length > 3 ? "…" : ""})`
        : "Ready",
    fraction: 1,
  });
  return book;
}

/** Slice a parsed document into titled sections using its chapter offsets. */
function sectionsOf(parsed: ParsedDocument): Section[] {
  const starts = parsed.chapterStarts ?? [];
  const titles = parsed.chapterTitles ?? [];
  if (starts.length === 0 || starts.length !== titles.length) {
    return [{ title: parsed.title, text: parsed.text }];
  }
  return starts.map((start, i) => ({
    title: titles[i],
    text: parsed.text.slice(start, starts[i + 1] ?? parsed.text.length).trim(),
  }));
}

async function parsePdf(
  file: File,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ParsedDocument> {
  const [pdfjs, workerModule] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const metadata = await pdf.getMetadata().catch(() => null);
  const info = (metadata?.info ?? {}) as Record<string, unknown>;
  const pages: string[] = [];
  const starts: number[] = [];
  const titles: string[] = [];
  let currentLength = 0;

  for (let index = 1; index <= pdf.numPages; index++) {
    onProgress?.({
      label: `Reading page ${index} of ${pdf.numPages}`,
      fraction: index / pdf.numPages,
    });
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let line = "";
    let lastY: number | null = null;

    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = item.transform?.[5] ?? null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 3 && line.trim()) {
        lines.push(line.trim());
        line = "";
      }
      line += `${item.str}${item.hasEOL ? "\n" : " "}`;
      if (item.hasEOL && line.trim()) {
        lines.push(line.trim());
        line = "";
      }
      lastY = y;
    }
    if (line.trim()) lines.push(line.trim());
    const pageText = normalizeText(lines.join("\n"));
    if (!pageText) continue;
    starts.push(currentLength);
    titles.push(`Page ${index}`);
    pages.push(pageText);
    currentLength += pageText.length + 2;
  }

  return {
    title: cleanMetadata(info.Title) || baseName(file.name),
    author: cleanMetadata(info.Author),
    text: pages.join("\n\n"),
    chapterStarts: starts,
    chapterTitles: titles,
  };
}

async function parseDocx(file: File): Promise<ParsedDocument> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return {
    title: baseName(file.name),
    text: normalizeText(result.value),
  };
}

async function parseEpub(
  file: File,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ParsedDocument> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const container = await zip.file("META-INF/container.xml")?.async("string");
  if (!container) throw new Error("This EPUB is missing its container metadata.");

  const containerDoc = parseXml(container);
  const rootfile = findElements(containerDoc, "rootfile")[0];
  const opfPath = rootfile?.getAttribute("full-path");
  if (!opfPath) throw new Error("This EPUB does not point to a readable package.");

  const opf = await zip.file(opfPath)?.async("string");
  if (!opf) throw new Error("This EPUB package could not be opened.");
  const opfDoc = parseXml(opf);
  const opfDir = dirname(opfPath);

  const title = textOfFirst(opfDoc, "title") || baseName(file.name);
  const author = textOfFirst(opfDoc, "creator") || undefined;
  const manifest = new Map<string, { href: string; mediaType: string }>();
  for (const item of findElements(opfDoc, "item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) {
      manifest.set(id, {
        href,
        mediaType: item.getAttribute("media-type") ?? "",
      });
    }
  }

  const spineIds = findElements(opfDoc, "itemref")
    .map((item) => item.getAttribute("idref"))
    .filter((id): id is string => Boolean(id));
  const chapters: { title: string; text: string }[] = [];

  for (let index = 0; index < spineIds.length; index++) {
    onProgress?.({
      label: `Reading chapter ${index + 1} of ${spineIds.length}`,
      fraction: (index + 1) / Math.max(1, spineIds.length),
    });
    const entry = manifest.get(spineIds[index]);
    if (!entry) continue;
    const path = resolveZipPath(opfDir, entry.href);
    const html = await zip.file(path)?.async("string");
    if (!html) continue;
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script, style, nav, svg").forEach((node) => node.remove());
    const chapterText = extractBlockText(doc.body);
    if (!chapterText) continue;
    const chapterTitle =
      doc.querySelector("h1, h2, title")?.textContent?.trim() ||
      `Chapter ${chapters.length + 1}`;
    chapters.push({ title: chapterTitle, text: chapterText });
  }

  if (chapters.length === 0) throw new Error("No readable chapters were found in this EPUB.");
  const starts: number[] = [];
  let length = 0;
  for (const chapter of chapters) {
    starts.push(length);
    length += chapter.text.length + 2;
  }
  return {
    title,
    author,
    text: chapters.map((chapter) => chapter.text).join("\n\n"),
    chapterStarts: starts,
    chapterTitles: chapters.map((chapter) => chapter.title),
  };
}

function parseHtml(html: string, fallbackTitle: string): ParsedDocument {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, noscript, svg, nav, footer").forEach((node) => node.remove());
  return {
    title:
      doc.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim() ||
      doc.title.trim() ||
      fallbackTitle,
    author:
      doc.querySelector('meta[name="author"]')?.getAttribute("content")?.trim() || undefined,
    text: extractBlockText(doc.querySelector("article") ?? doc.body),
  };
}

function extractBlockText(root: Element): string {
  const blocks = root.querySelectorAll("h1, h2, h3, h4, p, li, blockquote, pre");
  if (blocks.length === 0) return normalizeText(root.textContent ?? "");
  return normalizeText(
    Array.from(blocks)
      .map((node) => node.textContent?.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n\n"),
  );
}

function markdownToText(markdown: string): string {
  return normalizeText(
    markdown
      .replace(/^---[\s\S]*?---\s*/m, "")
      .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```\w*\n?|\n?```$/g, ""))
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^>\s?/gm, "")
      .replace(/^[-*+]\s+/gm, "• ")
      .replace(/^\d+\.\s+/gm, "")
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/([*_~`])(.*?)\1/g, "$2"),
  );
}

function parseRtf(rtf: string): string {
  const decoded = rtf
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\u(-?\d+)\??/g, (_, raw: string) => {
      const value = Number(raw);
      return String.fromCharCode(value < 0 ? value + 65536 : value);
    })
    .replace(/\\par[d]?\b/g, "\n\n")
    .replace(/\\tab\b/g, "\t")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "");
  return normalizeText(decoded);
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseXml(source: string): XMLDocument {
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("This ebook contains invalid XML.");
  return doc;
}

function findElements(doc: Document, localName: string): Element[] {
  return Array.from(doc.getElementsByTagName("*")).filter(
    (element) => element.localName.toLowerCase() === localName.toLowerCase(),
  );
}

function textOfFirst(doc: Document, localName: string): string {
  return findElements(doc, localName)[0]?.textContent?.trim() ?? "";
}

function cleanMetadata(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extensionOf(name: string): string {
  const match = name.toLowerCase().match(/\.([^.]+)$/);
  return match?.[1] ?? "";
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Untitled";
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function resolveZipPath(base: string, href: string): string {
  const raw = decodeURIComponent(href.split("#")[0]);
  const parts = `${base}/${raw}`.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/");
}
