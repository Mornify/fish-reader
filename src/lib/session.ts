/**
 * App-wide playback session. Owns the ReaderPlayer so narration KEEPS PLAYING
 * when the reader view closes — the mini player and the full reader are both
 * views over this one store. Also owns progress persistence, the sleep timer,
 * and macOS media-key integration (MediaSession).
 */
import { Book } from "../types";
import { Sentence, splitSentences } from "./sentences";
import { ReaderPlayer, WordRange } from "./player";
import { prefs, SavedVoice } from "./prefs";
import { saveBook } from "./books";
import { voicePreview } from "./preview";

export interface SessionState {
  book: Book | null;
  sentences: Sentence[];
  voice: SavedVoice | null;
  playing: boolean;
  sentenceIdx: number;
  word: WordRange | null;
  elapsed: number;
  totalSec: number;
  cached: boolean;
  error: string;
  /** seconds until the sleep timer pauses playback; null = off */
  sleepRemaining: number | null;
  /** narration volume 0..1 */
  volume: number;
  /** waiting on synthesis — the UI shows this instead of silent nothing */
  buffering: boolean;
}

const CHARS_PER_SEC = 15;

let state: SessionState = {
  book: null,
  sentences: [],
  voice: null,
  playing: false,
  sentenceIdx: 0,
  word: null,
  elapsed: 0,
  totalSec: 0,
  cached: false,
  error: "",
  sleepRemaining: null,
  volume: prefs.volume(),
  buffering: false,
};

let player: ReaderPlayer | null = null;
let ticker = 0;
let saveTimer = 0;
let sleepDeadline: number | null = null;
const listeners = new Set<() => void>();

function emit(patch: Partial<SessionState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function getSession(): SessionState {
  return state;
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function estAtSentence(sentences: Sentence[], i: number): number {
  let acc = 0;
  for (let k = 0; k < i && k < sentences.length; k++) acc += sentences[k].text.length / CHARS_PER_SEC;
  return acc;
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persistNow, 2000);
}

function persistNow() {
  if (!state.book) return;
  void saveBook(state.book).catch(() => {});
}

function startTicker() {
  if (ticker) return;
  ticker = window.setInterval(() => {
    const patch: Partial<SessionState> = {};
    if (player && state.playing) patch.elapsed = player.estElapsedSec();
    if (sleepDeadline !== null) {
      const left = Math.max(0, Math.round((sleepDeadline - Date.now()) / 1000));
      patch.sleepRemaining = left;
      if (left <= 0) {
        sleepDeadline = null;
        patch.sleepRemaining = null;
        session.pause();
        // pause() no-ops when nothing was playing, so stop the interval here
        // rather than relying on an onState callback that may never fire
        stopTickerIfIdle();
      }
    }
    if (Object.keys(patch).length) emit(patch);
  }, 500);
}

function stopTickerIfIdle() {
  if (!state.playing && sleepDeadline === null && ticker) {
    window.clearInterval(ticker);
    ticker = 0;
  }
}

function updateMediaMetadata() {
  if (!("mediaSession" in navigator) || !state.book) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: state.book.title,
    artist: state.voice ? `Read by ${state.voice.title}` : "Fish Reader",
    album: "Fish Reader",
  });
}

function setupMediaHandlers() {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  try {
    ms.setActionHandler("play", () => session.toggle());
    ms.setActionHandler("pause", () => session.pause());
    ms.setActionHandler("seekbackward", () => session.skipBySeconds(-15));
    ms.setActionHandler("seekforward", () => session.skipBySeconds(15));
    ms.setActionHandler("previoustrack", () => session.seekSentence(state.sentenceIdx - 1));
    ms.setActionHandler("nexttrack", () => session.seekSentence(state.sentenceIdx + 1));
  } catch {
    /* older webviews may not know some actions */
  }
}

function makePlayer(voice: SavedVoice): ReaderPlayer {
  player?.dispose();
  const p = new ReaderPlayer(
    state.sentences,
    voice.id,
    {
    onSentence: (i) => {
      emit({ sentenceIdx: i, elapsed: estAtSentence(state.sentences, i) });
      if (state.book) {
        state.book.progress = i;
        scheduleSave();
      }
    },
    onWord: (r) => {
      const l = state.word;
      if (r === l || (r && l && r.start === l.start && r.end === l.end)) return;
      emit({ word: r });
    },
    onState: (playing) => {
      emit({ playing });
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = playing ? "playing" : "paused";
      }
      if (playing) startTicker();
      else {
        emit({ buffering: false });
        persistNow();
        stopTickerIfIdle();
      }
    },
      onError: (m) => emit({ error: m }),
      onClipSource: (cached) => emit({ cached }),
      onBuffering: (buffering) => emit({ buffering }),
    },
    undefined,
    "en",
    prefs.expressive(),
  );
  p.setRate(prefs.rate());
  p.setVolume(prefs.volume());
  // seed the position, otherwise a lazily-created player (skip / seek / voice
  // change before pressing play) starts from sentence 0 and overwrites the
  // saved reading position
  p.index = Math.max(0, Math.min(state.sentenceIdx, state.sentences.length - 1));
  player = p;
  return p;
}

export const session = {
  /** Load a book into the session (no-op if it's already the current one). */
  openBook(book: Book) {
    if (state.book?.id === book.id) return;
    session.stop();
    const sentences = splitSentences(book.text);
    const totalSec = sentences.reduce((a, s) => a + s.text.length, 0) / CHARS_PER_SEC;
    const sentenceIdx = Math.max(0, Math.min(book.progress, sentences.length - 1));
    const voice: SavedVoice | null = book.voiceId
      ? { id: book.voiceId, title: book.voiceTitle ?? "voice", description: "", tags: [] }
      : prefs.defaultVoice();
    emit({
      book,
      sentences,
      voice,
      playing: false,
      sentenceIdx,
      word: null,
      elapsed: estAtSentence(sentences, sentenceIdx),
      totalSec,
      cached: false,
      error: "",
    });
    updateMediaMetadata();
    setupMediaHandlers();
  },

  /** Merge changes into the current book and persist them. */
  updateBook(patch: Partial<Book>) {
    if (!state.book) return;
    emit({ book: { ...state.book, ...patch } });
    persistNow();
  },

  /** Start playback; returns false when no voice is selected yet. */
  play(from?: number): boolean {
    if (!state.voice) return false;
    voicePreview.stop();
    emit({ error: "" });
    const p = player ?? makePlayer(state.voice);
    // passing `undefined` lets the player resume mid-sentence where it paused;
    // only force a position when we actually need to move
    p.play(from !== undefined ? from : p.index === state.sentenceIdx ? undefined : state.sentenceIdx);
    return true;
  },

  pause() {
    player?.pause();
  },

  /** Toggle; returns false when playing is impossible (no voice yet). */
  toggle(): boolean {
    if (state.playing) {
      session.pause();
      return true;
    }
    return session.play();
  },

  seekSentence(i: number) {
    const clamped = Math.max(0, Math.min(i, state.sentences.length - 1));
    if (player) {
      player.seekSentence(clamped);
      emit({ sentenceIdx: player.index, elapsed: player.estElapsedSec() });
    } else {
      emit({ sentenceIdx: clamped, elapsed: estAtSentence(state.sentences, clamped) });
      if (state.book) {
        state.book.progress = clamped;
        scheduleSave();
      }
    }
  },

  /** Scrubber drop: jump there and keep whatever the player was doing.
   *
   *  This used to force play() on every drop, so scrubbing while paused started
   *  talking — you could not move to a spot and stay stopped. seekSentence()
   *  already resumes when it was playing, so preserving state is simply a matter
   *  of not overriding it. `playing` is emitted alongside the new position so a
   *  scrub can never leave the button and the audio disagreeing. */
  seekSeconds(sec: number): boolean {
    if (!state.voice) return false;
    if (!player) makePlayer(state.voice);
    voicePreview.stop();
    player!.seekToSeconds(sec);
    emit({ elapsed: player!.estElapsedSec(), playing: player!.playing });
    return true;
  },

  skipBySeconds(delta: number): boolean {
    if (!state.voice) return false;
    if (!player) makePlayer(state.voice);
    player!.skipBySeconds(delta);
    // emit `playing` for the same reason as seekSeconds: the button and the
    // audio must never be able to disagree after a jump
    emit({ elapsed: player!.estElapsedSec(), playing: player!.playing });
    return true;
  },

  setRate(rate: number) {
    prefs.setRate(rate);
    player?.setRate(rate);
  },

  setVolume(volume: number) {
    prefs.setVolume(volume);
    player?.setVolume(volume);
    emit({ volume: Math.max(0, Math.min(1, volume)) });
  },

  /** Switch voice; keeps position, resumes if it was playing. */
  setVoice(voice: SavedVoice) {
    const wasPlaying = state.playing;
    emit({ voice });
    if (state.book) {
      session.updateBook({ voiceId: voice.id, voiceTitle: voice.title });
    }
    makePlayer(voice);
    updateMediaMetadata();
    if (wasPlaying) player?.play(state.sentenceIdx);
  },

  /** Sleep timer: pause after `minutes`; null cancels. */
  setSleep(minutes: number | null) {
    if (minutes === null) {
      sleepDeadline = null;
      emit({ sleepRemaining: null });
      stopTickerIfIdle();
      return;
    }
    sleepDeadline = Date.now() + minutes * 60_000;
    emit({ sleepRemaining: minutes * 60 });
    startTicker();
  },

  /** Stop playback and keep the session (mini player stays). */
  stopPlayback() {
    player?.pause();
  },

  /** Tear the whole session down (mini player disappears).
   *  `persist: false` when the book is being deleted — otherwise the pending
   *  save races the delete and can resurrect the book. */
  stop(persist = true) {
    window.clearTimeout(saveTimer);
    if (persist) persistNow();
    player?.dispose();
    player = null;
    sleepDeadline = null;
    if (ticker) {
      window.clearInterval(ticker);
      ticker = 0;
    }
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = "none";
      navigator.mediaSession.metadata = null;
    }
    emit({
      book: null,
      sentences: [],
      voice: null,
      playing: false,
      sentenceIdx: 0,
      word: null,
      elapsed: 0,
      totalSec: 0,
      cached: false,
      error: "",
      sleepRemaining: null,
      buffering: false,
    });
  },

  clearError() {
    if (state.error) emit({ error: "" });
  },

  /** Route an error raised outside playback (e.g. browsing voices) through the
   *  same handling — including the "reconnect your account" flow. */
  reportError(message: string) {
    emit({ error: message });
  },

  /** Recreate the player with expressive tags on/off, keeping position. */
  setExpressive(on: boolean) {
    prefs.setExpressive(on);
    if (!state.voice) return;
    const wasPlaying = state.playing;
    makePlayer(state.voice);
    if (wasPlaying) player?.play(state.sentenceIdx);
  },
};

// ONE AUDIO AT A TIME, app-wide: the moment any voice preview starts, the
// narration pauses (the reverse — narration silencing previews — is handled
// inside play/seek above).
voicePreview.subscribe((id) => {
  if (id && state.playing) session.pause();
});
