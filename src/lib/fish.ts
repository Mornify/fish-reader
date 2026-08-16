import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { isDesktop, webListVoices, webTts } from "./platform";

/** One voice from the Fish Audio catalog (subset of fields we use). */
export interface Voice {
  _id: string;
  title: string;
  description: string;
  cover_image?: string;
  tags: string[];
  languages: string[];
  samples: { title: string; text: string; audio: string }[];
  visibility: string;
}

export interface VoicePage {
  total: number;
  items: Voice[];
  has_more?: boolean;
}

export type VoiceSort = "score" | "task_count" | "created_at";

export interface VoiceQuery {
  title?: string;
  /** repeated tag filters — ANDed server-side (e.g. ["deep","male"]) */
  tags?: string[];
  language?: string;
  sortBy?: VoiceSort;
  pageNumber?: number;
  pageSize?: number;
  selfOnly?: boolean;
}

export const DEFAULT_MODEL = "s2.1-pro-free";

export function listVoices(q: VoiceQuery = {}): Promise<VoicePage> {
  if (!isDesktop()) return webListVoices(q);
  return invoke<VoicePage>("list_voices", {
    title: q.title ?? null,
    tags: q.tags ?? null,
    language: q.language ?? null,
    sortBy: q.sortBy ?? null,
    pageNumber: q.pageNumber ?? 1,
    pageSize: q.pageSize ?? 24,
    selfOnly: q.selfOnly ?? false,
  });
}

/** One word's timing from Fish's alignment, in seconds within the clip. */
export interface TtsSegment {
  text: string;
  start: number;
  end: number;
}

export interface TtsClip {
  /** Absolute path on disk (content-addressed cache). */
  path: string;
  cached: boolean;
  /** Word timings; empty when the timestamp endpoint was unavailable. */
  segments: TtsSegment[];
}

/** Synthesize one sentence/chunk. Cached on disk — repeat calls are free. */
export async function ttsClip(
  text: string,
  voiceId: string,
  model: string = DEFAULT_MODEL,
): Promise<TtsClip> {
  if (!isDesktop()) return webTts(text, voiceId, model);
  return invoke<TtsClip>("tts", { text, voiceId, model });
}

/** Turn a cache path into a URL the webview can actually play. */
export function clipUrl(clip: TtsClip): string {
  // on the web the path is already a blob: URL the <audio> element can use
  return isDesktop() ? convertFileSrc(clip.path) : clip.path;
}
