import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Book } from "./types";
import { deleteBook, loadBooks, makeBook, saveBook } from "./lib/books";
import { prefs, SavedVoice } from "./lib/prefs";
import { getSession, session, subscribeSession } from "./lib/session";
import { Sidebar } from "./components/Sidebar";
import { Library } from "./components/Library";
import { Reader } from "./components/Reader";
import { VoicesLibrary } from "./components/VoicesLibrary";
import { CompactWindow, MiniPlayer } from "./components/MiniPlayer";
import { enterMiniWindow, exitMiniWindow } from "./lib/windowMode";
import { AvailableUpdate, checkForUpdate } from "./lib/updater";
import { hasApiKey, isMissingKeyError } from "./lib/account";
import { isDesktop } from "./lib/platform";
import { Onboarding } from "./components/Onboarding";
import { Settings } from "./components/Settings";
import type { AppView } from "./components/Sidebar";
import "./App.css";

const ImportModal = lazy(() =>
  import("./components/ImportModal").then((module) => ({ default: module.ImportModal })),
);

const WELCOME = `Welcome to Fish Reader.

This is your own private reader. Import a book or paste any text, pick a voice, and press play. The text is highlighted sentence by sentence — and word by word — while it reads, so your eyes always know where you are.

Try it right now: press the play button below. If no voice is selected yet, the voice panel will open — pick one, tap the orb to hear a preview, and hit play again.

Everything stays on this Mac. Audio is cached, so replaying a book never costs anything twice.`;

export default function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [reading, setReading] = useState<Book | null>(null);
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<AppView>("library");
  const [loading, setLoading] = useState(true);
  const [miniWindow, setMiniWindow] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [updating, setUpdating] = useState(false);
  /** null = still checking, "full" = first run, "reconnect" = key stopped working */
  const [onboarding, setOnboarding] = useState<"full" | "reconnect" | null | undefined>(
    undefined,
  );

  useEffect(() => {
    void checkForUpdate().then(setUpdate);
    void hasApiKey().then((ok) => setOnboarding(ok ? null : "full"));
  }, []);

  // NOTE: subscribe to narrow slices, not the whole session object. `emit()`
  // returns a new object on every word highlight (~5×/s), so subscribing to
  // the store itself would re-render the whole app, and the library, continuously.
  const sessionError = useSyncExternalStore(subscribeSession, () => getSession().error);
  useEffect(() => {
    if (sessionError && isMissingKeyError(sessionError)) {
      session.pause();
      session.clearError();
      // the full-page connect screen cannot fit the 440x148 always-on-top
      // window, and CompactWindow's expand button unmounts with it
      if (miniWindow) void leaveMini();
      setOnboarding("reconnect");
    }
  }, [sessionError, miniWindow]);

  const [updateError, setUpdateError] = useState("");

  async function installUpdate() {
    if (!update || updating) return;
    setUpdating(true);
    setUpdateError("");
    try {
      await update.install(); // relaunches on success
    } catch {
      // a silent revert to "Update & Restart" after a long wait reads as broken
      setUpdateError("The update couldn't be installed. Check your connection and try again.");
      setUpdating(false);
    }
  }

  async function goMini() {
    if (await enterMiniWindow()) setMiniWindow(true);
  }

  async function leaveMini() {
    await exitMiniWindow();
    setMiniWindow(false);
  }

  useEffect(() => {
    void (async () => {
      let list = await loadBooks().catch(() => []);
      // only ever seed the sample once — otherwise a book the user deleted
      // reappears by itself whenever the library is empty
      if (list.length === 0 && localStorage.getItem("welcome-seeded") !== "1") {
        const welcome = makeBook("Welcome to Fish Reader", WELCOME);
        await saveBook(welcome).catch(() => {});
        localStorage.setItem("welcome-seeded", "1");
        list = [welcome];
      }
      setBooks(list);
      setLoading(false);

      // merge favorites seeded from outside (fish.audio hearts import)
      try {
        if (!isDesktop()) return;
        const raw = await invoke<string | null>("read_favorites_seed");
        if (raw) prefs.mergeFavorites(JSON.parse(raw) as SavedVoice[]);
      } catch {
        /* no seed — fine */
      }
    })();
  }, []);

  async function handleImported(book: Book) {
    await saveBook(book).catch(() => {});
    setBooks((b) => [book, ...b]);
    setImporting(false);
    setView("library");
    setReading(book);
  }

  async function handleDelete(book: Book) {
    // stop without persisting, so a queued progress save can't recreate the file
    if (getSession().book?.id === book.id) session.stop(false);
    await deleteBook(book.id).catch(() => {});
    setBooks((b) => b.filter((x) => x.id !== book.id));
  }

  async function backToLibrary() {
    setReading(null);
    setBooks(await loadBooks().catch(() => books));
  }

  const sessionBook = useSyncExternalStore(subscribeSession, () => getSession().book);

  // hold the UI back one tick so first-run users never see the library flash
  if (onboarding === undefined) return <div className="boot-screen" />;

  if (onboarding) {
    return (
      <Onboarding
        mode={onboarding}
        onDone={() => setOnboarding(null)}
      />
    );
  }

  if (miniWindow) {
    return <CompactWindow onExpand={() => void leaveMini()} />;
  }

  if (reading) {
    return <Reader book={reading} onBack={backToLibrary} onMiniWindow={() => void goMini()} />;
  }

  return (
    <div className="shell">
      <Sidebar
        active={view}
        onNavigate={setView}
        onUpload={() => setImporting(true)}
        onSettings={() => setSettingsOpen(true)}
      />
      {view === "library" ? (
        loading ? (
          <LibrarySkeleton />
        ) : (
          <Library
            books={books}
            query={query}
            onQuery={setQuery}
            onImport={() => setImporting(true)}
            onOpen={setReading}
            onDelete={handleDelete}
          />
        )
      ) : (
        <VoicesLibrary />
      )}
      {update && (
        <div className="update-banner">
          <span>
            Fish Reader <strong>v{update.version}</strong> is available
          </span>
          <button className="button primary compact" onClick={() => void installUpdate()} disabled={updating}>
            {updating ? "Updating…" : "Update & Restart"}
          </button>
          {!updating && (
            <button className="text-button" onClick={() => setUpdate(null)}>
              Later
            </button>
          )}
          {updateError && <span className="update-error">{updateError}</span>}
        </div>
      )}
      {sessionError && !isMissingKeyError(sessionError) && (
        <div className="toast error-toast app-toast" onClick={() => session.clearError()}>
          {sessionError}
        </div>
      )}
      {sessionBook && <MiniPlayer onExpand={() => setReading(sessionBook)} />}
      {settingsOpen && (
        <Settings
          onClose={() => setSettingsOpen(false)}
          onReconnect={() => {
            setSettingsOpen(false);
            setReading(null);
            setOnboarding("reconnect");
          }}
        />
      )}
      {importing && (
        <Suspense fallback={<div className="overlay" aria-label="Opening importer" />}>
          <ImportModal onClose={() => setImporting(false)} onImported={handleImported} />
        </Suspense>
      )}
    </div>
  );
}

function LibrarySkeleton() {
  return (
    <main className="main-col skeleton-page view-enter" aria-label="Loading library">
      <div className="skeleton top" />
      <div className="skeleton heading" />
      <div className="skeleton hero" />
      <div className="skeleton-grid">
        <div className="skeleton cover" />
        <div className="skeleton cover" />
        <div className="skeleton cover" />
      </div>
    </main>
  );
}
