import { Voice } from "./fish";

/** Slim voice record we persist locally (favorites / recents). */
export interface SavedVoice {
  id: string;
  title: string;
  description: string;
  tags: string[];
  /** preview sample mp3 URL from the Fish catalog, if any */
  sample?: string;
}

export function slim(v: Voice): SavedVoice {
  return {
    id: v._id,
    title: v.title,
    description: v.description,
    tags: v.tags ?? [],
    sample: v.samples?.[0]?.audio,
  };
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("fish-reader:prefs", { detail: key }));
}

export const prefs = {
  favorites(): SavedVoice[] {
    return read("fav-voices", []);
  },
  toggleFavorite(v: SavedVoice): SavedVoice[] {
    const cur = prefs.favorites();
    const next = cur.some((f) => f.id === v.id) ? cur.filter((f) => f.id !== v.id) : [v, ...cur];
    write("fav-voices", next);
    return next;
  },
  /** Merge externally-imported favorites (e.g. hearts from fish.audio). */
  mergeFavorites(incoming: SavedVoice[]): SavedVoice[] {
    const cur = prefs.favorites();
    const fresh = incoming.filter((v) => v?.id && !cur.some((f) => f.id === v.id));
    if (fresh.length === 0) return cur;
    const next = [...cur, ...fresh];
    write("fav-voices", next);
    return next;
  },
  recents(): SavedVoice[] {
    return read("recent-voices", []);
  },
  pushRecent(v: SavedVoice): SavedVoice[] {
    const next = [v, ...prefs.recents().filter((r) => r.id !== v.id)].slice(0, 12);
    write("recent-voices", next);
    return next;
  },
  defaultVoice(): SavedVoice | null {
    return read("default-voice", null);
  },
  setDefaultVoice(v: SavedVoice) {
    write("default-voice", v);
  },
  rate(): number {
    return read("rate", 1);
  },
  setRate(r: number) {
    write("rate", r);
  },
  readerSize(): number {
    return read("reader-size", 2);
  },
  setReaderSize(size: number) {
    write("reader-size", Math.max(1, Math.min(3, size)));
  },
  readerFont(): "inter" | "dyslexic" {
    return read("reader-font", "inter");
  },
  setReaderFont(font: "inter" | "dyslexic") {
    write("reader-font", font);
  },
  /** expressive narration: auto emotion tags on dialogue */
  expressive(): boolean {
    return read("expressive", false);
  },
  setExpressive(on: boolean) {
    write("expressive", on);
  },
  volume(): number {
    return read("volume", 1);
  },
  setVolume(v: number) {
    write("volume", Math.max(0, Math.min(1, v)));
  },
};
