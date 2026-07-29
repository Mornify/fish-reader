export interface Book {
  id: string;
  title: string;
  author?: string;
  /** full plain text (chapters concatenated) */
  text: string;
  /** char offsets where chapters start, aligned with chapterTitles */
  chapterStarts: number[];
  chapterTitles: string[];
  /** last-read sentence index */
  progress: number;
  /** bookmarked sentence indexes */
  bookmarks: number[];
  voiceId?: string;
  voiceTitle?: string;
  createdAt: number;
  /** deterministic cover hue */
  hue: number;
  /** original import format, used for helpful library metadata */
  sourceType?: string;
  /** original file name when imported from disk */
  fileName?: string;
  /** front/back-matter sections dropped by the import refinement pass */
  skippedSections?: string[];
}
