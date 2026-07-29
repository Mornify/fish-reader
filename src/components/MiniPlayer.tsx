import { useSyncExternalStore } from "react";
import { getSession, session, subscribeSession } from "../lib/session";
import { orbStyle } from "../lib/orb";
import { CloseIcon, ExpandIcon, PauseIcon, PlayIcon } from "./Icons";

interface Props {
  /** open the full reader for the session's book */
  onExpand: () => void;
}

/** Compact bottom bar shown outside the reader while a book is loaded —
 *  narration keeps playing while you browse. */
export function MiniPlayer({ onExpand }: Props) {
  const s = useSyncExternalStore(subscribeSession, getSession);
  if (!s.book) return null;

  const pct = s.totalSec > 0 ? Math.min(100, (s.elapsed / s.totalSec) * 100) : 0;

  function toggle() {
    if (!session.toggle()) onExpand(); // no voice picked yet → open the reader
  }

  return (
    <footer className="mini-player">
      <div className="mini-progress">
        <div className="fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="mini-row">
        <button className="mini-open" onClick={onExpand} title="Open reader">
          <span className="mini-cover" style={{ background: `hsl(${s.book.hue} 35% 60%)` }} />
          <span className="mini-titles">
            <strong>{s.book.title}</strong>
            <span>{s.voice ? `Read by ${s.voice.title}` : "Pick a voice to start"}</span>
          </span>
        </button>
        <div className="mini-controls">
          <button className="icon-btn skip" onClick={() => session.skipBySeconds(-15)}>
            <SkipGlyph back /> <em>15</em>
          </button>
          <button className="play-circle small" onClick={toggle}>
            {s.playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button className="icon-btn skip" onClick={() => session.skipBySeconds(15)}>
            <SkipGlyph /> <em>15</em>
          </button>
        </div>
        <button
          className="icon-btn mini-close"
          onClick={() => session.stop()}
          title="Stop and close player"
        >
          <CloseIcon />
        </button>
      </div>
    </footer>
  );
}

/** Full-window compact layout used in the floating always-on-top mini window. */
export function CompactWindow({ onExpand }: { onExpand: () => void }) {
  const s = useSyncExternalStore(subscribeSession, getSession);
  const pct = s.totalSec > 0 ? Math.min(100, (s.elapsed / s.totalSec) * 100) : 0;
  return (
    <div className="compact-window" data-tauri-drag-region>
      <div className="mini-progress">
        <div className="fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="compact-row" data-tauri-drag-region>
        {s.voice && <span className="orb small" style={orbStyle(s.voice.id)} />}
        <div className="mini-titles" data-tauri-drag-region>
          <strong>{s.book?.title ?? "Fish Reader"}</strong>
          <span>{s.voice ? `Read by ${s.voice.title}` : ""}</span>
        </div>
        <div className="mini-controls">
          <button className="icon-btn skip" onClick={() => session.skipBySeconds(-15)}>
            <SkipGlyph back /> <em>15</em>
          </button>
          <button className="play-circle small" onClick={() => session.toggle()}>
            {s.playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button className="icon-btn skip" onClick={() => session.skipBySeconds(15)}>
            <SkipGlyph /> <em>15</em>
          </button>
        </div>
        <button className="icon-btn" title="Back to full window" onClick={onExpand}>
          <ExpandIcon />
        </button>
      </div>
    </div>
  );
}

function SkipGlyph({ back = false }: { back?: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={back ? {} : { transform: "scaleX(-1)" }}
    >
      <path d="M12 4a8 8 0 1 1-7.3 4.7" />
      <path d="M4 3v6h6" />
    </svg>
  );
}
