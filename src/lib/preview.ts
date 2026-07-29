/**
 * App-wide voice-preview singleton. Exactly ONE preview can play at a time,
 * from anywhere in the UI (voices panel, saved-voices page). Starting a new
 * preview stops the old one; stop() silences everything — call it whenever a
 * view closes/unmounts or book playback starts.
 */

let audio: HTMLAudioElement | null = null;
let currentId = "";
const listeners = new Set<(id: string) => void>();

function setCurrent(id: string) {
  if (currentId === id) return;
  currentId = id;
  listeners.forEach((listener) => listener(currentId));
}

export const voicePreview = {
  /** Toggle a preview: same id stops it, a new id replaces whatever plays. */
  toggle(id: string, url: string, onIssue?: (message: string) => void) {
    if (currentId === id) {
      voicePreview.stop();
      return;
    }
    audio?.pause();
    const next = new Audio(url);
    audio = next;
    setCurrent(id);
    next.onended = () => {
      if (audio === next) setCurrent("");
    };
    next.onerror = () => {
      if (audio === next) {
        setCurrent("");
        onIssue?.("This voice preview is not available.");
      }
    };
    void next.play().catch(() => {
      if (audio === next) {
        setCurrent("");
        onIssue?.("This voice preview could not be played.");
      }
    });
  },

  /** Stop any playing preview (safe to call when nothing plays). */
  stop() {
    audio?.pause();
    audio = null;
    setCurrent("");
  },

  /** Id of the voice currently previewing, "" when silent. */
  current(): string {
    return currentId;
  },

  /** Subscribe to preview-state changes; returns an unsubscribe fn. */
  subscribe(listener: (id: string) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
