import { ttsClip, clipUrl, DEFAULT_MODEL, TtsSegment } from "./fish";
import { autoTag } from "./expressive";
import { Sentence, WordSpan, wordSpans } from "./sentences";

const PREFETCH_AHEAD = 3;

interface ClipData {
  url: string;
  segments: TtsSegment[];
  /** true when served from the on-disk cache (no API call) */
  cached: boolean;
}

/** A word timing mapped onto document character offsets. */
interface TimedWord {
  t0: number;
  t1: number;
  start: number;
  end: number;
}

const normalizeWord = (s: string) =>
  s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "");

/** Anything with no letters or digits ("* * *", "• • •") isn't worth a TTS call. */
export function isSpeakable(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/** Tweak text for the VOICE only (display stays untouched): ALL-CAPS headings
 *  read better title-cased, and headings without punctuation get a period so
 *  the narrator pauses instead of running into the next sentence. */
export function normalizeForSpeech(text: string): string {
  let spoken = text;
  const letters = spoken.replace(/[^\p{L}]/gu, "");
  const headingLike = spoken.length <= 60 && !/[.!?…]["”']?\s*$/.test(spoken);
  if (
    headingLike &&
    letters.length >= 4 &&
    letters === letters.toUpperCase() &&
    letters !== letters.toLowerCase()
  ) {
    spoken = spoken
      .toLowerCase()
      .replace(/(^|[\s\-—])(\p{L})/gu, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
  }
  if (headingLike && /[\p{L}\p{N}]$/u.test(spoken.trimEnd())) {
    spoken = `${spoken.trimEnd()}.`;
  }
  return spoken;
}

/** Match Fish's alignment segments to the sentence's word spans, in order. */
function mapSegmentsToWords(
  segments: TtsSegment[],
  sentence: Sentence,
  spans: WordSpan[],
): TimedWord[] {
  const out: TimedWord[] = [];
  let wi = 0;
  for (const seg of segments) {
    const target = normalizeWord(seg.text);
    if (!target) continue;
    let found = -1;
    for (let j = wi; j < Math.min(wi + 8, spans.length); j++) {
      const w = normalizeWord(sentence.text.slice(spans[j].start, spans[j].end));
      if (w === target) {
        found = j;
        break;
      }
    }
    if (found === -1) continue;
    wi = found + 1;
    out.push({
      t0: seg.start,
      t1: seg.end,
      start: sentence.start + spans[found].start,
      end: sentence.start + spans[found].end,
    });
  }
  return out;
}

export interface WordRange {
  /** document-offset range of the word being spoken */
  start: number;
  end: number;
}

export interface PlayerCallbacks {
  onSentence?: (index: number) => void;
  onWord?: (range: WordRange | null) => void;
  onState?: (playing: boolean) => void;
  onError?: (message: string) => void;
  /** fires as each clip starts: true = played from local cache (free) */
  onClipSource?: (cached: boolean) => void;
}

/**
 * Plays a list of sentences through Fish Audio TTS.
 *
 * - Synthesizes per sentence; prefetches PREFETCH_AHEAD clips so playback
 *   never waits on the network after the first sentence.
 * - Sentence highlight is exact (we know which clip is playing).
 * - Word highlight is interpolated across the clip via char-weight timing.
 * - Speed uses HTMLAudioElement.playbackRate (0.5–4x, pitch-preserving).
 */
export class ReaderPlayer {
  private sentences: Sentence[];
  private words: WordSpan[][];
  private voiceId: string;
  private model: string;
  private locale: string;
  private cb: PlayerCallbacks;

  private clipCache = new Map<number, Promise<ClipData>>();
  private audio: HTMLAudioElement | null = null;
  private audioIndex = -1;
  private audioSegments: TtsSegment[] = [];
  private raf = 0;
  private epoch = 0; // bumped on seek/stop; stale async work checks it
  private rate = 1;

  index = 0;
  playing = false;
  /** set when playback ran off the end; next play() restarts from the top */
  private finished = false;

  /** cumulative estimated seconds at the START of each sentence (char model) */
  private cumSec: number[] = [];
  private totalSec = 0;
  private static readonly CHARS_PER_SEC = 15;

  /** when true, dialogue sentences get auto emotion tags before synthesis */
  private expressive: boolean;

  constructor(
    sentences: Sentence[],
    voiceId: string,
    cb: PlayerCallbacks = {},
    model: string = DEFAULT_MODEL,
    locale = "en",
    expressive = false,
  ) {
    this.expressive = expressive;
    this.sentences = sentences;
    this.words = sentences.map((s) => wordSpans(s.text, locale));
    this.voiceId = voiceId;
    this.model = model;
    this.locale = locale;
    this.cb = cb;
    void this.locale;

    let acc = 0;
    for (const s of sentences) {
      this.cumSec.push(acc);
      acc += s.text.length / ReaderPlayer.CHARS_PER_SEC;
    }
    this.totalSec = acc;
  }

  /** Estimated total duration in seconds (at 1x). */
  estTotalSec(): number {
    return this.totalSec;
  }

  /** Estimated elapsed seconds: char model up to the current sentence plus
   *  the actual playback position inside the current clip. */
  estElapsedSec(): number {
    const base = this.cumSec[this.index] ?? 0;
    const inClip = this.audio && !Number.isNaN(this.audio.currentTime) ? this.audio.currentTime : 0;
    return base + inClip;
  }

  /** Seek to an absolute position on the estimated timeline (snaps to the
   *  sentence containing that moment). */
  seekToSeconds(sec: number) {
    const target = Math.max(0, Math.min(sec, this.totalSec - 0.1));
    let i = 0;
    while (i + 1 < this.cumSec.length && this.cumSec[i + 1] <= target) i++;
    this.seekSentence(i);
  }

  /** Jump roughly `delta` seconds (negative = back) using the char model. */
  skipBySeconds(delta: number) {
    this.seekToSeconds(this.estElapsedSec() + delta);
  }

  get length() {
    return this.sentences.length;
  }

  play(from?: number) {
    if (
      from === undefined &&
      this.audio &&
      this.audio.paused &&
      this.audioIndex === this.index &&
      !this.finished &&
      this.audio.currentTime > 0 &&
      this.audio.currentTime < this.audio.duration
    ) {
      const epoch = ++this.epoch;
      this.playing = true;
      this.cb.onState?.(true);
      this.audio.onended = () => {
        if (epoch !== this.epoch) return;
        void this.playIndex(this.index + 1, epoch);
      };
      this.audio.playbackRate = this.rate;
      this.audio.volume = this.volume;
      void this.audio
        .play()
        .then(() => this.startTicker(this.index, epoch, this.audioSegments))
        .catch((error) => {
          if (epoch !== this.epoch) return;
          this.playing = false;
          this.cb.onState?.(false);
          this.cb.onError?.(String(error));
        });
      return;
    }
    if (from !== undefined) this.index = Math.max(0, Math.min(from, this.sentences.length - 1));
    else if (this.finished) this.index = 0; // reached the end → read again
    this.finished = false;
    this.epoch++;
    this.playing = true;
    this.cb.onState?.(true);
    void this.playIndex(this.index, this.epoch);
  }

  pause() {
    this.epoch++;
    this.playing = false;
    this.audio?.pause();
    this.stopTicker();
    this.cb.onState?.(false);
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seekSentence(i: number) {
    const wasPlaying = this.playing;
    this.pause();
    this.finished = false;
    this.index = Math.max(0, Math.min(i, this.sentences.length - 1));
    this.cb.onSentence?.(this.index);
    if (wasPlaying) this.play();
  }

  skipSentences(delta: number) {
    this.seekSentence(this.index + delta);
  }

  setRate(rate: number) {
    this.rate = Math.max(0.5, Math.min(4, rate));
    if (this.audio) this.audio.playbackRate = this.rate;
  }

  private volume = 1;

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.audio) this.audio.volume = this.volume;
  }

  dispose() {
    this.pause();
    this.audio?.removeAttribute("src");
    this.audio = null;
    this.audioIndex = -1;
    this.audioSegments = [];
    this.clipCache.clear();
  }

  /** Kick off TTS for index i (and remember the promise). */
  private fetchClip(i: number): Promise<ClipData> {
    if (i < 0 || i >= this.sentences.length) return Promise.reject(new Error("out of range"));
    let p = this.clipCache.get(i);
    if (!p) {
      const raw = this.sentences[i].text;
      const spoken = normalizeForSpeech(this.expressive ? autoTag(raw) : raw);
      p = ttsClip(spoken, this.voiceId, this.model).then((clip) => ({
        url: clipUrl(clip),
        segments: clip.segments ?? [],
        cached: clip.cached,
      }));
      p.catch(() => this.clipCache.delete(i)); // allow retry after transient errors
      this.clipCache.set(i, p);
    }
    return p;
  }

  private prefetch(from: number) {
    let queued = 0;
    for (let i = from; i < this.sentences.length && queued < PREFETCH_AHEAD; i++) {
      if (!isSpeakable(this.sentences[i].text)) continue;
      this.fetchClip(i).catch(() => {});
      queued++;
    }
  }

  private async playIndex(i: number, epoch: number, attempt = 0) {
    if (i >= this.sentences.length) {
      this.playing = false;
      this.finished = true;
      this.cb.onState?.(false);
      this.cb.onWord?.(null);
      return;
    }
    this.index = i;
    this.cb.onSentence?.(i);

    // separators like "* * *" get skipped silently — no TTS call, no pause
    if (!isSpeakable(this.sentences[i].text)) {
      void this.playIndex(i + 1, epoch);
      return;
    }
    this.prefetch(i + 1);

    let clip: ClipData;
    try {
      clip = await this.fetchClip(i);
    } catch (e) {
      if (epoch !== this.epoch) return;
      if (attempt === 0) {
        // transient network/API hiccup: the failed promise already evicted
        // itself from clipCache, so retry once before surfacing an error
        await new Promise((r) => setTimeout(r, 800));
        if (epoch !== this.epoch) return;
        void this.playIndex(i, epoch, 1);
        return;
      }
      this.playing = false;
      this.cb.onState?.(false);
      this.cb.onError?.(String(e));
      return;
    }
    if (epoch !== this.epoch) return; // user paused/seeked while we were loading
    this.cb.onClipSource?.(clip.cached);

    const audio = new Audio(clip.url);
    this.audio = audio;
    this.audioIndex = i;
    this.audioSegments = clip.segments;
    audio.playbackRate = this.rate;
    audio.volume = this.volume;
    audio.onended = () => {
      if (epoch !== this.epoch) return;
      void this.playIndex(i + 1, epoch);
    };
    audio.onerror = () => {
      if (epoch !== this.epoch) return;
      this.playing = false;
      this.cb.onState?.(false);
      this.cb.onError?.(`audio element failed for sentence ${i}`);
    };
    try {
      await audio.play();
    } catch (e) {
      if (epoch === this.epoch) {
        this.playing = false;
        this.cb.onState?.(false);
        this.cb.onError?.(String(e));
      }
      return;
    }
    this.startTicker(i, epoch, clip.segments);
  }

  /** rAF loop emitting the active word. Uses Fish's real word timings when
   *  available; falls back to char-weight interpolation otherwise. */
  private startTicker(i: number, epoch: number, segments: TtsSegment[]) {
    this.stopTicker();
    const spans = this.words[i];
    const sentence = this.sentences[i];
    const timed = segments.length > 0 ? mapSegmentsToWords(segments, sentence, spans) : [];
    let p = 0;

    const tick = () => {
      if (epoch !== this.epoch || !this.audio) return;
      const { currentTime, duration } = this.audio;
      if (timed.length > 0) {
        while (p < timed.length - 1 && currentTime >= timed[p + 1].t0) p++;
        while (p > 0 && currentTime < timed[p].t0) p--; // handles rare rewinds
        const cur = timed[p];
        if (currentTime >= cur.t0 - 0.06) {
          this.cb.onWord?.({ start: cur.start, end: cur.end });
        }
      } else if (duration > 0 && spans.length > 0) {
        const frac = Math.min(currentTime / duration, 0.999);
        const active = spans.find((w) => frac < w.cumWeight) ?? spans[spans.length - 1];
        this.cb.onWord?.({ start: sentence.start + active.start, end: sentence.start + active.end });
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopTicker() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
