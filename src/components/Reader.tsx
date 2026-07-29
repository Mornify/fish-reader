import { memo, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Book } from "../types";
import { Sentence } from "../lib/sentences";
import { WordRange } from "../lib/player";
import { prefs, SavedVoice } from "../lib/prefs";
import { countTaggable } from "../lib/expressive";
import { getSession, session, subscribeSession } from "../lib/session";
import { PlayerBar } from "./PlayerBar";
import { VoicesPanel } from "./VoicesPanel";
import { toggleFullscreen } from "../lib/windowMode";
import { orbStyle } from "../lib/orb";
import { ArrowLeftIcon, CloseIcon, ExpandIcon, ListIcon, SparkleIcon } from "./Icons";

interface Props {
  book: Book;
  onBack: () => void;
  onMiniWindow: () => void;
}

interface Paragraph {
  start: number;
  end: number;
  sentenceFrom: number; // global sentence index range [from, to)
  sentenceTo: number;
}

export function Reader({ book, onBack, onMiniWindow }: Props) {
  // bind this view to the app-wide playback session
  useEffect(() => {
    session.openBook(book);
  }, [book]);

  const s = useSyncExternalStore(subscribeSession, getSession);
  const activeBook = s.book?.id === book.id ? s.book : book;
  const sentences = s.book?.id === book.id ? s.sentences : [];
  const paragraphs = useMemo(
    () => buildParagraphs(activeBook.text, sentences),
    [activeBook.text, sentences],
  );

  const [voicesOpen, setVoicesOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [readerSize, setReaderSize] = useState(prefs.readerSize());
  const [readerFont, setReaderFont] = useState(prefs.readerFont());
  const [rate, setRateState] = useState(prefs.rate());
  const [expressive, setExpressive] = useState(prefs.expressive());

  function toggle() {
    session.clearError();
    if (!session.toggle()) setVoicesOpen(true);
  }

  function selectVoice(v: SavedVoice) {
    setVoicesOpen(false);
    session.setVoice(v);
  }

  function setRate(r: number) {
    setRateState(r);
    session.setRate(r);
  }

  function seekSeconds(sec: number) {
    if (!session.seekSeconds(sec)) setVoicesOpen(true);
    scrollToCurrent("smooth");
  }

  function skipBy(delta: number) {
    if (!session.skipBySeconds(delta)) setVoicesOpen(true);
  }

  function bookmark() {
    const idx = getSession().sentenceIdx;
    const cur = getSession().book?.bookmarks ?? [];
    const exists = cur.includes(idx);
    const next = exists ? cur.filter((i) => i !== idx) : [...cur, idx].sort((a, b) => a - b);
    session.updateBook({ bookmarks: next });
    setToast(exists ? "Bookmark removed" : "Bookmark saved");
    setTimeout(() => setToast(""), 1800);
  }

  function changeReaderSize(direction: -1 | 1) {
    const next = Math.max(1, Math.min(3, readerSize + direction));
    setReaderSize(next);
    prefs.setReaderSize(next);
  }

  function toggleFont() {
    const next = readerFont === "inter" ? "dyslexic" : "inter";
    setReaderFont(next);
    prefs.setReaderFont(next);
  }

  function toggleExpressive() {
    const next = !expressive;
    setExpressive(next);
    session.setExpressive(next);
    if (next) {
      const n = countTaggable(sentences.map((sn) => sn.text));
      setToast(
        n > 0
          ? `✨ Expressive on — ${n} ${n === 1 ? "line" : "lines"} in this book will be acted out`
          : "✨ Expressive on — this book has no dialogue cues, so narration stays neutral",
      );
    } else {
      setToast("Expressive narration off");
    }
    setTimeout(() => setToast(""), 3200);
  }

  function scrollToCurrent(behavior: ScrollBehavior) {
    setTimeout(() => {
      document
        .getElementById(`s-${getSession().sentenceIdx}`)
        ?.scrollIntoView({ block: "center", behavior });
    }, 60);
  }

  // opening a book lands you exactly where you left off
  useEffect(() => {
    scrollToCurrent("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBook.id]);

  // keep the active sentence centered while playing
  useEffect(() => {
    if (!s.playing) return;
    document.getElementById(`s-${s.sentenceIdx}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [s.sentenceIdx, s.playing]);

  // keyboard: space toggles, arrows skip ±15s
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        skipBy(-15);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        skipBy(15);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasChapters = activeBook.chapterTitles.length > 1;
  const bookmarks = activeBook.bookmarks;

  return (
    <div className="reader view-enter">
      <header className="reader-head titlebar-pad" data-tauri-drag-region>
        <button className="icon-button reader-back" onClick={onBack} title="Back to Library (keeps playing)">
          <ArrowLeftIcon />
        </button>
        <button
          className={`icon-button drawer-toggle ${drawerOpen ? "active" : ""}`}
          onClick={() => setDrawerOpen((o) => !o)}
          title="Chapters & bookmarks"
        >
          <ListIcon />
        </button>
        <div className="reader-title">
          <strong>{activeBook.title}</strong>
        </div>
        <button className="voice-chip header-voice" onClick={() => setVoicesOpen(true)}>
          {s.voice?.id && <span className="orb small" style={orbStyle(s.voice.id)} />}
          Read by <strong>{s.voice?.title ?? "…"}</strong>
        </button>
      </header>

      <div className="reader-body">
        {paragraphs.length > 0 && (
          <article
            className={`reader-column reader-size-${readerSize} ${readerFont === "dyslexic" ? "reader-font-dys" : ""}`}
          >
            {paragraphs.map((p, pi) => (
              <Para
                key={pi}
                text={activeBook.text.slice(p.start, p.end)}
                pStart={p.start}
                sentences={sentences.slice(p.sentenceFrom, p.sentenceTo)}
                firstIdx={p.sentenceFrom}
                activeIdx={s.sentenceIdx >= p.sentenceFrom && s.sentenceIdx < p.sentenceTo ? s.sentenceIdx : -1}
                word={s.word && s.word.start >= p.start && s.word.end <= p.end ? s.word : null}
                onSeek={(i) => session.seekSentence(i)}
              />
            ))}
            <div className="reader-tail" />
          </article>
        )}
      </div>

      <ReaderDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        hasChapters={hasChapters}
        chapterTitles={activeBook.chapterTitles}
        chapterStarts={activeBook.chapterStarts}
        sentences={sentences}
        sentenceIdx={s.sentenceIdx}
        bookmarks={bookmarks}
        onJump={(i) => {
          session.seekSentence(i);
          scrollToCurrent("smooth");
        }}
        onRemoveBookmark={(i) =>
          session.updateBook({ bookmarks: bookmarks.filter((b) => b !== i) })
        }
      />

      {toast && <div className="toast">{toast}</div>}
      {s.error && (
        <div className="toast error-toast" onClick={() => session.clearError()}>
          {s.error}
        </div>
      )}

      <PlayerBar
        title={activeBook.title}
        hue={activeBook.hue}
        playing={s.playing}
        elapsedSec={s.elapsed}
        totalSec={s.totalSec}
        rate={rate}
        cachedClip={s.cached && s.playing}
        rightExtras={
          <>
            <button
              className={`icon-btn setting ${expressive ? "on" : ""}`}
              onClick={toggleExpressive}
              title="Expressive narration: acts out dialogue with auto emotion tags"
            >
              <SparkleIcon />
            </button>
            <button
              className={`icon-btn setting font-mini ${readerFont === "dyslexic" ? "on" : ""}`}
              onClick={toggleFont}
              title="Dyslexia-friendly font"
            >
              Dy
            </button>
            <div className="reader-size-control bar-size" aria-label="Text size">
              <button onClick={() => changeReaderSize(-1)} disabled={readerSize === 1} aria-label="Smaller text">
                A
              </button>
              <span />
              <button onClick={() => changeReaderSize(1)} disabled={readerSize === 3} aria-label="Larger text">
                A
              </button>
            </div>
            <button className="icon-btn setting" onClick={() => void toggleFullscreen()} title="Fullscreen">
              <ExpandIcon />
            </button>
          </>
        }
        onToggle={toggle}
        onBack15={() => skipBy(-15)}
        onFwd15={() => skipBy(15)}
        onSeekSeconds={seekSeconds}
        onRate={setRate}
        onBookmark={bookmark}
        bookmarked={bookmarks.includes(s.sentenceIdx)}
        onVoices={() => setVoicesOpen(true)}
        sleepRemaining={s.sleepRemaining}
        onSleep={(m) => session.setSleep(m)}
        volume={s.volume}
        onVolume={(v) => session.setVolume(v)}
        onMiniWindow={onMiniWindow}
      />

      <VoicesPanel
        open={voicesOpen}
        currentVoiceId={s.voice?.id}
        onSelect={selectVoice}
        onClose={() => setVoicesOpen(false)}
      />
    </div>
  );
}

function ReaderDrawer(props: {
  open: boolean;
  onClose: () => void;
  hasChapters: boolean;
  chapterTitles: string[];
  chapterStarts: number[];
  sentences: Sentence[];
  sentenceIdx: number;
  bookmarks: number[];
  onJump: (sentenceIdx: number) => void;
  onRemoveBookmark: (sentenceIdx: number) => void;
}) {
  const [tab, setTab] = useState<"chapters" | "bookmarks">(props.hasChapters ? "chapters" : "bookmarks");

  /** first sentence index at/after a char offset */
  function sentenceAt(charOffset: number): number {
    const { sentences } = props;
    let lo = 0,
      hi = sentences.length - 1,
      ans = sentences.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sentences[mid].end > charOffset) {
        ans = mid;
        hi = mid - 1;
      } else lo = mid + 1;
    }
    return ans;
  }

  const currentOffset = props.sentences[props.sentenceIdx]?.start ?? 0;
  const activeChapter = props.chapterStarts.reduce(
    (acc, start, i) => (start <= currentOffset ? i : acc),
    0,
  );

  return (
    <aside className={`reader-drawer ${props.open ? "open" : ""}`} aria-hidden={!props.open}>
      <header>
        <div className="tabs">
          {props.hasChapters && (
            <button className={tab === "chapters" ? "active" : ""} onClick={() => setTab("chapters")}>
              Chapters
            </button>
          )}
          <button className={tab === "bookmarks" ? "active" : ""} onClick={() => setTab("bookmarks")}>
            Bookmarks
          </button>
        </div>
        <button className="icon-button" onClick={props.onClose} aria-label="Close panel">
          <CloseIcon />
        </button>
      </header>

      {tab === "chapters" && (
        <div className="drawer-list">
          {props.chapterTitles.map((title, i) => (
            <button
              key={i}
              className={`drawer-row ${i === activeChapter ? "active" : ""}`}
              onClick={() => props.onJump(sentenceAt(props.chapterStarts[i]))}
            >
              <span className="drawer-num">{i + 1}</span>
              <span className="drawer-label">{title}</span>
            </button>
          ))}
        </div>
      )}

      {tab === "bookmarks" && (
        <div className="drawer-list">
          {props.bookmarks.length === 0 && (
            <p className="muted small pad">
              Tap the bookmark icon in the player to save your spot — saved spots appear here.
            </p>
          )}
          {props.bookmarks.map((i) => (
            <div key={i} className="drawer-row bookmark-row">
              <button className="drawer-label" onClick={() => props.onJump(i)}>
                {props.sentences[i]?.text.slice(0, 90) ?? `Sentence ${i + 1}`}
              </button>
              <button
                className="drawer-remove"
                onClick={() => props.onRemoveBookmark(i)}
                aria-label="Remove bookmark"
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

/** One paragraph. Re-renders only when its own active-sentence/word changes. */
const Para = memo(function Para(props: {
  text: string;
  pStart: number;
  sentences: Sentence[];
  firstIdx: number;
  activeIdx: number;
  word: WordRange | null;
  onSeek: (i: number) => void;
}) {
  const { sentences, firstIdx, activeIdx, word, onSeek } = props;
  return (
    <p>
      {sentences.map((s, i) => {
        const gi = firstIdx + i;
        const isActive = gi === activeIdx;
        const isRead = activeIdx === -1 ? false : gi < activeIdx;
        let inner: React.ReactNode = s.text;
        if (isActive && word && word.start >= s.start && word.end <= s.end) {
          const a = word.start - s.start;
          const b = word.end - s.start;
          inner = (
            <>
              {s.text.slice(0, a)}
              <mark className="word">{s.text.slice(a, b)}</mark>
              {s.text.slice(b)}
            </>
          );
        }
        return (
          <span
            key={gi}
            id={isActive ? `s-${gi}` : undefined}
            className={`sentence ${isActive ? "active" : ""} ${isRead ? "read" : ""}`}
            onClick={() => onSeek(gi)}
          >
            {inner}{" "}
          </span>
        );
      })}
      {sentences.length === 0 && props.text}
    </p>
  );
});

function buildParagraphs(text: string, sentences: Sentence[]): Paragraph[] {
  const out: Paragraph[] = [];
  const re = /\n{2,}/g;
  let start = 0;
  let si = 0;
  const flush = (end: number) => {
    if (end <= start) return;
    const from = si;
    while (si < sentences.length && sentences[si].start < end) si++;
    if (text.slice(start, end).trim()) out.push({ start, end, sentenceFrom: from, sentenceTo: si });
  };
  for (const m of text.matchAll(re)) {
    flush(m.index!);
    start = m.index! + m[0].length;
  }
  flush(text.length);
  return out;
}
