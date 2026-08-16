import { invoke } from "@tauri-apps/api/core";
import { Book } from "../types";
import { splitSentences } from "./sentences";

/** ~ chars spoken per minute at 1x, used for duration estimates. */
const CHARS_PER_MIN = 900;

export function estimateMinutes(chars: number): number {
  return chars / CHARS_PER_MIN;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0) return `${h} hr${h > 1 ? "s" : ""} ${m} min${m !== 1 ? "s" : ""}`;
  const shownMinutes = Math.max(1, m);
  return `${shownMinutes} min${shownMinutes !== 1 ? "s" : ""}`;
}

export function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export function makeBook(title: string, text: string, author?: string): Book {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title,
    author,
    text,
    chapterStarts: [0],
    chapterTitles: [title],
    progress: 0,
    bookmarks: [],
    createdAt: Date.now(),
    hue: hueFromString(title + id),
  };
}

/** Sentence counts are expensive (full Intl.Segmenter pass — ~750ms on a
 *  novel), so cache per book. Keyed on length so re-imported text invalidates. */
const sentenceCounts = new Map<string, number>();

function sentenceCount(book: Book): number {
  const key = `${book.id}:${book.text.length}`;
  let count = sentenceCounts.get(key);
  if (count === undefined) {
    count = splitSentences(book.text).length;
    sentenceCounts.set(key, count);
  }
  return count;
}

export function bookProgress(book: Book): number {
  // cheap exit first — an unread book never needs segmenting at all
  if (book.progress <= 0) return 0;
  const count = sentenceCount(book);
  if (count <= 1) return 0;
  return Math.min(100, Math.round((book.progress / (count - 1)) * 100));
}

const wordCounts = new Map<string, number>();

export function wordsIn(text: string): number {
  if (!text.trim()) return 0;
  // library totals re-run on every render/keystroke; memoize by size+head
  const key = `${text.length}:${text.slice(0, 32)}`;
  let count = wordCounts.get(key);
  if (count === undefined) {
    count = text.trim().split(/\s+/).length;
    wordCounts.set(key, count);
  }
  return count;
}

export async function saveBook(book: Book): Promise<void> {
  await invoke("save_book", { id: book.id, data: JSON.stringify(book) });
}

export async function loadBooks(): Promise<Book[]> {
  const raw = await invoke<unknown[]>("list_books");
  const books = raw as Book[];
  return books
    .filter((b) => b && typeof b.id === "string" && typeof b.text === "string")
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteBook(id: string): Promise<void> {
  await invoke("delete_book", { id });
}
