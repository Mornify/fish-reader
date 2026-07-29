/** A sentence with its [start, end) character range in the source document. */
export interface Sentence {
  text: string;
  start: number;
  end: number;
}

/** A word's [start, end) range *within its sentence*, plus its share of the
 *  sentence's estimated speaking time (used to interpolate the word highlight,
 *  since Fish Audio returns no timestamps). */
export interface WordSpan {
  start: number;
  end: number;
  /** cumulative weight at the END of this word, normalized 0..1 */
  cumWeight: number;
}

const MAX_TTS_CHARS = 400;

/**
 * Split text into sentences with document offsets. Uses Intl.Segmenter so it
 * handles abbreviations, quotes, and non-English text (e.g. Greek) correctly.
 * Sentences longer than MAX_TTS_CHARS are hard-split at the nearest space so
 * each TTS request stays snappy.
 */
export function splitSentences(text: string, locale = "en"): Sentence[] {
  const seg = new Intl.Segmenter(locale, { granularity: "sentence" });
  const out: Sentence[] = [];

  for (const s of seg.segment(text)) {
    pushTrimmed(out, s.segment, s.index);
  }
  return out.flatMap(splitOverlong);
}

function pushTrimmed(out: Sentence[], segment: string, index: number) {
  const leading = segment.length - segment.trimStart().length;
  const trimmed = segment.trim();
  if (!trimmed) return;
  out.push({ text: trimmed, start: index + leading, end: index + leading + trimmed.length });
}

function splitOverlong(s: Sentence): Sentence[] {
  if (s.text.length <= MAX_TTS_CHARS) return [s];
  const parts: Sentence[] = [];
  let offset = 0;
  while (offset < s.text.length) {
    let cut = Math.min(offset + MAX_TTS_CHARS, s.text.length);
    if (cut < s.text.length) {
      const lastSpace = s.text.lastIndexOf(" ", cut);
      if (lastSpace > offset + 50) cut = lastSpace;
    }
    const piece = s.text.slice(offset, cut).trim();
    if (piece) {
      const pieceStart = s.start + offset + (s.text.slice(offset, cut).length - s.text.slice(offset, cut).trimStart().length);
      parts.push({ text: piece, start: pieceStart, end: pieceStart + piece.length });
    }
    offset = cut;
  }
  return parts;
}

/**
 * Word spans + cumulative speaking-time weights for one sentence.
 * Weight model: characters + a fixed per-word cost (approximates that short
 * words still take time to say).
 */
export function wordSpans(sentenceText: string, locale = "en"): WordSpan[] {
  const seg = new Intl.Segmenter(locale, { granularity: "word" });
  const words: { start: number; end: number; w: number }[] = [];
  for (const s of seg.segment(sentenceText)) {
    if (!(s as Intl.SegmentData & { isWordLike?: boolean }).isWordLike) continue;
    words.push({ start: s.index, end: s.index + s.segment.length, w: s.segment.length + 2.5 });
  }
  const total = words.reduce((a, b) => a + b.w, 0) || 1;
  let cum = 0;
  return words.map((w) => {
    cum += w.w;
    return { start: w.start, end: w.end, cumWeight: cum / total };
  });
}
