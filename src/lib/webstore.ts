/**
 * Browser storage for the web build — the counterpart to the Rust backend's
 * files. Books and generated audio live in IndexedDB so they survive reloads
 * and work offline; nothing is ever uploaded.
 *
 * Raw IndexedDB on purpose: no dependency, no supply chain, small bundle.
 */

const DB_NAME = "fish-reader";
const DB_VERSION = 1;
const BOOKS = "books";
const AUDIO = "audio";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BOOKS)) db.createObjectStore(BOOKS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(AUDIO)) db.createObjectStore(AUDIO);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
    request.onblocked = () => reject(new Error("IndexedDB blocked by another tab"));
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = run(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.onabort = () => reject(transaction.error);
      }),
  );
}

/* ---------------- books ---------------- */

export async function putBook(id: string, data: unknown): Promise<void> {
  await tx(BOOKS, "readwrite", (s) => s.put({ id, data }));
}

export async function allBooks(): Promise<unknown[]> {
  const rows = await tx<{ id: string; data: unknown }[]>(BOOKS, "readonly", (s) => s.getAll());
  return rows.map((row) => row.data).filter(Boolean);
}

export async function removeBook(id: string): Promise<void> {
  await tx(BOOKS, "readwrite", (s) => s.delete(id));
}

/* ---------------- generated audio ---------------- */

export interface CachedClip {
  blob: Blob;
  segments: { text: string; start: number; end: number }[];
}

export async function getClip(key: string): Promise<CachedClip | undefined> {
  return tx<CachedClip | undefined>(AUDIO, "readonly", (s) => s.get(key));
}

export async function putClip(key: string, clip: CachedClip): Promise<void> {
  try {
    await tx(AUDIO, "readwrite", (s) => s.put(clip, key));
  } catch (error) {
    // Storage full or evicted: playback must continue regardless — the clip
    // simply won't be cached and will be re-synthesised next time.
    if ((error as DOMException)?.name === "QuotaExceededError") return;
    throw error;
  }
}

export async function cacheStats(): Promise<{ bytes: number; files: number }> {
  const db = await openDb();
  return new Promise((resolve) => {
    let bytes = 0;
    let files = 0;
    const transaction = db.transaction(AUDIO, "readonly");
    const cursorRequest = transaction.objectStore(AUDIO).openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return resolve({ bytes, files });
      const value = cursor.value as CachedClip;
      if (value?.blob) {
        bytes += value.blob.size;
        files++;
      }
      cursor.continue();
    };
    cursorRequest.onerror = () => resolve({ bytes, files });
  });
}

export async function clearClips(): Promise<void> {
  await tx(AUDIO, "readwrite", (s) => s.clear());
}

/** Ask the browser to keep our data instead of evicting it under pressure.
 *  Safari in particular clears unused site data after ~7 days otherwise. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate) return null;
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}
