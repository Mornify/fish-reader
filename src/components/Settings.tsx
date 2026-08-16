import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isDesktop, webCacheInfo, webClearCache } from "../lib/platform";
import { disconnectAccount } from "../lib/account";
import { checkForUpdate } from "../lib/updater";
import { session } from "../lib/session";
import { CloseIcon } from "./Icons";
import pkg from "../../package.json";

// single source of truth — never drifts from what was actually released
const APP_VERSION = pkg.version;

interface Props {
  onClose: () => void;
  /** re-run the connect flow (also used when a key stops working) */
  onReconnect: () => void;
}

interface CacheInfo {
  bytes: number;
  files: number;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Settings({ onClose, onReconnect }: Props) {
  const [cache, setCache] = useState<CacheInfo | null>(null);
  // distinguish "still counting" from "couldn't count" — otherwise a failure
  // leaves the row saying "Calculating…" forever with a dead button
  const [cacheState, setCacheState] = useState<"loading" | "ready" | "error">("loading");
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [updateNote, setUpdateNote] = useState("");
  const [checking, setChecking] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<Awaited<ReturnType<typeof checkForUpdate>>>(null);
  const [installing, setInstalling] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  async function refreshCache() {
    try {
      setCache(isDesktop() ? await invoke<CacheInfo>("cache_info") : await webCacheInfo());
      setCacheState("ready");
    } catch {
      setCache(null);
      setCacheState("error");
    }
  }

  useEffect(() => {
    void refreshCache();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function clearCache() {
    // the player holds asset:// URLs to these exact files; deleting them
    // mid-sentence kills narration with no explanation
    session.pause();
    setClearing(true);
    try {
      if (isDesktop()) await invoke("clear_cache");
      else await webClearCache();
      await refreshCache();
      setConfirmClear(false);
    } finally {
      setClearing(false);
    }
  }

  async function checkUpdates() {
    setChecking(true);
    setUpdateNote("");
    const update = await checkForUpdate();
    setPendingUpdate(update);
    // never claim "restart to update" — restarting installs nothing; offer the
    // actual install instead
    setUpdateNote(update ? `Version ${update.version} is ready to install.` : "You're up to date.");
    setChecking(false);
  }

  async function installUpdate() {
    if (!pendingUpdate || installing) return;
    setInstalling(true);
    try {
      await pendingUpdate.install(); // relaunches on success
    } catch {
      setUpdateNote("The update couldn't be installed. Check your connection and try again.");
      setInstalling(false);
    }
  }

  async function disconnect() {
    session.stop();
    await disconnectAccount();
    onReconnect();
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <section
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-heading"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="settings-heading">Settings</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close settings">
            <CloseIcon />
          </button>
        </header>

        <div className="settings-row">
          <div>
            <strong>Fish Audio account</strong>
            <p>Used to narrate your books. Stored only on this Mac.</p>
          </div>
          {confirmDisconnect ? (
            <span className="settings-confirm">
              <button className="text-button" onClick={() => setConfirmDisconnect(false)}>
                Cancel
              </button>
              <button className="text-button danger" onClick={() => void disconnect()}>
                Disconnect
              </button>
            </span>
          ) : (
            <button className="button secondary compact" onClick={() => setConfirmDisconnect(true)}>
              Disconnect
            </button>
          )}
        </div>

        <div className="settings-row">
          <div>
            <strong>Narration cache</strong>
            <p>
              {cacheState === "loading" && "Calculating…"}
              {cacheState === "error" && "Couldn't read the cache folder."}
              {cacheState === "ready" &&
                cache !== null &&
                (cache.files === 0
                  ? "Nothing cached yet — audio is saved here as you listen."
                  : `${cache.files.toLocaleString()} clips · ${formatSize(cache.bytes)} — clearing means already-heard audio is generated again.`)}
            </p>
          </div>
          {confirmClear ? (
            <span className="settings-confirm">
              <button className="text-button" onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
              <button className="text-button danger" onClick={() => void clearCache()} disabled={clearing}>
                {clearing ? "Clearing…" : "Clear"}
              </button>
            </span>
          ) : (
            <button
              className="button secondary compact"
              onClick={() => setConfirmClear(true)}
              disabled={!cache || cache.bytes === 0}
            >
              Clear cache
            </button>
          )}
        </div>

        <div className="settings-row">
          <div>
            <strong>Version {APP_VERSION}</strong>
            <p>{updateNote || "Fish Reader updates itself when a new version is published."}</p>
          </div>
          {pendingUpdate ? (
            <button
              className="button primary compact"
              onClick={() => void installUpdate()}
              disabled={installing}
            >
              {installing ? "Installing…" : "Install & Restart"}
            </button>
          ) : (
            <button
              className="button secondary compact"
              onClick={() => void checkUpdates()}
              disabled={checking}
            >
              {checking ? "Checking…" : "Check for updates"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
