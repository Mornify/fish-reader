import { useEffect, useRef, useState } from "react";
import { openSoundOutputSettings } from "../lib/windowMode";
import {
  BoltIcon,
  BookmarkIcon,
  DevicesIcon,
  MoonIcon,
  PauseIcon,
  PipIcon,
  PlayIcon,
  SpeakerIcon,
} from "./Icons";

interface Props {
  title: string;
  hue: number;
  playing: boolean;
  elapsedSec: number;
  totalSec: number;
  rate: number;
  /** current sentence is playing from the local cache (no API call) */
  cachedClip?: boolean;
  /** extra controls (reading settings) rendered in the right cluster */
  rightExtras?: React.ReactNode;
  onToggle: () => void;
  onBack15: () => void;
  onFwd15: () => void;
  onSeekSeconds: (sec: number) => void;
  onRate: (r: number) => void;
  onBookmark: () => void;
  bookmarked: boolean;
  onVoices: () => void;
  /** waiting on synthesis — show progress rather than silence */
  buffering?: boolean;
  /** seconds until sleep pause; null = timer off */
  sleepRemaining: number | null;
  onSleep: (minutes: number | null) => void;
  volume: number;
  onVolume: (v: number) => void;
  onMiniWindow: () => void;
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

export function PlayerBar(p: Props) {
  // While dragging, `drag` holds the preview fraction; null = follow playback.
  const [drag, setDrag] = useState<number | null>(null);
  // After releasing, keep showing where it was dropped until playback actually
  // reports a position near there. Without this the thumb snaps back to the old
  // position for up to half a second (the ticker interval) and then jumps
  // forward again — the single jerkiest thing about the old scrubber.
  const [pending, setPending] = useState<number | null>(null);
  // True right after a discontinuity (scrub, ±15s skip, chapter jump) so the
  // bar lands instantly instead of sliding across the track.
  const [jumped, setJumped] = useState(false);
  const hitRef = useRef<HTMLDivElement>(null);

  const liveFrac = p.totalSec > 0 ? Math.min(1, p.elapsedSec / p.totalSec) : 0;
  const frac = drag ?? pending ?? liveFrac;
  const shownElapsed = frac === liveFrac ? p.elapsedSec : frac * p.totalSec;

  const previous = useRef(liveFrac);
  useEffect(() => {
    const delta = Math.abs(liveFrac - previous.current);
    previous.current = liveFrac;
    // one tick advances the bar by tick/total; anything much larger is a seek
    if (delta <= 0.02) return;
    setJumped(true);
    const timer = setTimeout(() => setJumped(false), 80);
    return () => clearTimeout(timer);
  }, [liveFrac]);

  useEffect(() => {
    if (pending === null) return;
    if (Math.abs(liveFrac - pending) < 0.02) {
      setPending(null);
      return;
    }
    // never let the preview stick if the seek is slow or fails
    const timer = setTimeout(() => setPending(null), 1500);
    return () => clearTimeout(timer);
  }, [liveFrac, pending]);

  // Animate only while playback is ticking forward on its own. The transition
  // is matched to the 500ms ticker so the fill moves continuously instead of
  // gliding for 400ms and then sitting still for 100ms.
  const smooth = p.playing && drag === null && pending === null && !jumped;

  function fracFromEvent(e: React.PointerEvent): number {
    const r = hitRef.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  }

  return (
    <footer className="player-bar">
      <div className="progress-line">
        <span className="time">{fmt(shownElapsed)}</span>
        <div
          ref={hitRef}
          className={`track-hit ${drag !== null ? "dragging" : ""} ${smooth ? "smooth" : ""}`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag(fracFromEvent(e));
          }}
          onPointerMove={(e) => {
            if (drag !== null) setDrag(fracFromEvent(e));
          }}
          onPointerUp={(e) => {
            if (drag === null) return;
            const dropped = fracFromEvent(e);
            // hold the dropped position on screen until playback catches up
            setPending(dropped);
            setDrag(null);
            p.onSeekSeconds(dropped * p.totalSec);
          }}
          onPointerCancel={() => setDrag(null)}
        >
          <div className="track">
            <div className="fill" style={{ width: `${frac * 100}%` }} />
          </div>
          <div className="thumb" style={{ left: `${frac * 100}%` }} />
        </div>
        <span
          className={`cache-dot ${p.cachedClip ? "on" : ""}`}
          title="This sentence was already generated — playing from local cache, free"
        >
          <BoltIcon />
        </span>
        <span className="time">-{fmt(Math.max(0, p.totalSec - shownElapsed))}</span>
      </div>

      <div className="player-row">
        <div className="now-playing">
          <div className="mini-cover" style={{ background: `hsl(${p.hue} 35% 60%)` }} />
          <span className="np-title">{p.title}</span>
        </div>

        <div className="transport">
          <button
            className={`icon-btn ${p.bookmarked ? "bookmarked" : ""}`}
            title={p.bookmarked ? "Remove bookmark" : "Bookmark this spot"}
            onClick={p.onBookmark}
          >
            <BookmarkIcon fill={p.bookmarked ? "currentColor" : "none"} />
          </button>
          <button className="icon-btn skip" onClick={p.onBack15}>
            <SkipIcon back /> <em>15</em>
          </button>
          <button
            className={`play-circle ${p.buffering ? "busy" : ""}`}
            onClick={p.onToggle}
            title={p.buffering ? "Preparing narration…" : undefined}
          >
            {p.buffering ? <span className="spinner" /> : p.playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button className="icon-btn skip" onClick={p.onFwd15}>
            <SkipIcon /> <em>15</em>
          </button>
          <select
            className="rate"
            value={p.rate}
            onChange={(e) => p.onRate(Number(e.target.value))}
            title="Reading speed"
          >
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r}x
              </option>
            ))}
          </select>
          <span className={`sleep-wrap ${p.sleepRemaining !== null ? "on" : ""}`} title="Sleep timer">
            <MoonIcon />
            {p.sleepRemaining !== null && (
              <em className="sleep-left">{Math.max(1, Math.ceil(p.sleepRemaining / 60))}m</em>
            )}
            <select
              className="sleep-select"
              value=""
              onChange={(e) => {
                const v = e.target.value;
                p.onSleep(v === "off" ? null : Number(v));
              }}
              aria-label="Sleep timer"
            >
              <option value="" disabled hidden />
              <option value="off">Timer off</option>
              <option value="15">In 15 min</option>
              <option value="30">In 30 min</option>
              <option value="45">In 45 min</option>
              <option value="60">In 60 min</option>
            </select>
          </span>
        </div>

        <div className="bar-right">
          {p.rightExtras}
          <div className="volume-wrap" title="Narration volume">
            <SpeakerIcon />
            <input
              className="volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={p.volume}
              onChange={(e) => p.onVolume(Number(e.target.value))}
              aria-label="Narration volume"
              style={{ "--fill": `${p.volume * 100}%` } as React.CSSProperties}
            />
          </div>
          <button
            className="icon-btn"
            title="Choose output device (AirPods, speakers…) — opens macOS Sound settings"
            onClick={() => void openSoundOutputSettings()}
          >
            <DevicesIcon />
          </button>
          <button className="icon-btn" title="Mini player window" onClick={p.onMiniWindow}>
            <PipIcon />
          </button>
        </div>
      </div>
    </footer>
  );
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, "0");
  const rr = String(r).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${rr}` : `${mm}:${rr}`;
}

function SkipIcon({ back = false }: { back?: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      style={back ? {} : { transform: "scaleX(-1)" }}
    >
      <path d="M12 4a8 8 0 1 1-7.3 4.7" />
      <path d="M4 3v6h6" />
    </svg>
  );
}
