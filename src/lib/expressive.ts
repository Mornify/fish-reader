/**
 * Auto emotion tags ("expressive narration").
 *
 * Fish Audio's S2 models act out bracket cues placed in the text — e.g.
 * `[whispering] "Come here," she said.` The cues are free (not billed), are
 * never spoken, and never appear in the alignment, so the karaoke highlight
 * is unaffected. Fish's public API has no server-side auto-tagger (that's a
 * web-playground feature), so this module is ours: high-precision rules that
 * only fire when the AUTHOR states the delivery — attribution verbs and
 * adverbs around quoted dialogue — plus a couple of unambiguous punctuation
 * cases. Narration sentences are left untouched: a wrongly-excited narrator
 * sounds worse than a neutral one.
 */

/** double quotes only — apostrophes must NOT count as dialogue */
const QUOTE = /["“”«»]/;

const VERB_TAGS: [RegExp, string][] = [
  [/\b(whisper(?:ed|s|ing)?|murmur(?:ed|s)?|mutter(?:ed|s)?)\b/i, "[whispering]"],
  [/\b(shout(?:ed|s|ing)?|yell(?:ed|s)?|bellow(?:ed|s)?|cried out)\b/i, "[shouting]"],
  [/\b(scream(?:ed|s|ing)?|shriek(?:ed|s)?)\b/i, "[screaming]"],
  [/\b(sob(?:bed|s|bing)?|wept|weep(?:s|ing)?)\b/i, "[sobbing]"],
  [/\b(laugh(?:ed|s|ing)?|chuckl(?:ed|es|ing)?|giggl(?:ed|es|ing)?)\b/i, "[chuckling]"],
  [/\b(sigh(?:ed|s|ing)?)\b/i, "[sighing]"],
  [/\b(gasp(?:ed|s|ing)?)\b/i, "[gasping]"],
  [/\b(groan(?:ed|s|ing)?|moan(?:ed|s|ing)?)\b/i, "[groaning]"],
  [/\b(growl(?:ed|s)?|snarl(?:ed|s)?|snapped at|barked)\b/i, "[angry]"],
];

const ADVERB_TAGS: [RegExp, string][] = [
  [/\bnervously\b/i, "[nervous]"],
  [/\bangrily|furiously\b/i, "[angry]"],
  [/\bsadly|mournfully\b/i, "[sad]"],
  [/\bhappily|cheerfully\b/i, "[happy]"],
  [/\bexcitedly|eagerly\b/i, "[excited]"],
  [/\b(quietly|softly|gently)\b/i, "[soft tone]"],
  [/\bcalmly\b/i, "[calm]"],
  [/\b(anxiously|worriedly)\b/i, "[anxious]"],
  [/\b(sarcastically|dryly|wryly)\b/i, "[sarcastic]"],
  [/\bproudly\b/i, "[proud]"],
  [/\b(coldly|flatly)\b/i, "[indifferent]"],
  [/\bconfidently|firmly\b/i, "[confident]"],
];

/** How many of these sentences would actually receive tags — used to tell
 *  the user what turning the feature on will really do for THIS book. */
export function countTaggable(sentenceTexts: string[]): number {
  let n = 0;
  for (const t of sentenceTexts) if (autoTag(t) !== t) n++;
  return n;
}

/** Returns the text to SEND TO TTS (displayed text stays untouched). */
export function autoTag(text: string): string {
  if (!QUOTE.test(text)) {
    // narration: only the unambiguous interrobang
    return /[?!][!?]/.test(text) ? `[surprised] ${text}` : text;
  }

  const tags: string[] = [];
  for (const [re, tag] of VERB_TAGS) {
    if (re.test(text)) {
      tags.push(tag);
      break; // one delivery verb is enough
    }
  }
  for (const [re, tag] of ADVERB_TAGS) {
    if (tags.length >= 2) break;
    if (re.test(text) && !tags.includes(tag)) tags.push(tag);
  }
  if (tags.length === 0) {
    if (/[?!][!?]/.test(text)) tags.push("[surprised]");
    else if (/!/.test(text)) tags.push("[excited]");
  }
  return tags.length > 0 ? `${tags.join("")} ${text}` : text;
}
