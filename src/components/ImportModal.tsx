import { useEffect, useRef, useState } from "react";
import { makeBook } from "../lib/books";
import {
  ACCEPT_ATTRIBUTE,
  importBookFile,
  ImportProgress,
} from "../lib/importers";
import { Book } from "../types";
import { CloseIcon, UploadIcon } from "./Icons";

interface Props {
  onClose: () => void;
  onImported: (book: Book) => void;
}

type ImportMode = "file" | "paste";

export function ImportModal({ onClose, onImported }: Props) {
  const [mode, setMode] = useState<ImportMode>("file");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = Boolean(progress && progress.fraction !== 1);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [busy, onClose]);

  function importPaste() {
    const cleanText = text.trim();
    if (!cleanText) return;
    const firstLine = cleanText.split("\n").find(Boolean) ?? "Untitled";
    const name = title.trim() || firstLine.slice(0, 80);
    const book = makeBook(name, cleanText, author.trim() || undefined);
    book.sourceType = "PASTE";
    onImported(book);
  }

  async function importFile(file: File) {
    setError("");
    setProgress({ label: `Opening ${file.name}` });
    try {
      const book = await importBookFile(file, setProgress);
      onImported(book);
    } catch (reason) {
      setProgress(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <div className="overlay" onMouseDown={() => !busy && onClose()}>
      <section
        className="modal import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-heading"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="import-heading">Add content</h2>
          <button className="icon-button" onClick={onClose} disabled={busy} aria-label="Close importer">
            <CloseIcon />
          </button>
        </header>

        <div className="mode-switch" role="tablist" aria-label="Import method">
          <button
            className={mode === "file" ? "active" : ""}
            role="tab"
            aria-selected={mode === "file"}
            onClick={() => setMode("file")}
          >
            Import a file
          </button>
          <button
            className={mode === "paste" ? "active" : ""}
            role="tab"
            aria-selected={mode === "paste"}
            onClick={() => setMode("paste")}
          >
            Paste text
          </button>
        </div>

        {mode === "file" ? (
          <>
            <button
              className={`drop-zone ${dragging ? "dragging" : ""} ${busy ? "busy" : ""}`}
              onClick={() => !busy && fileRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                if (!busy) setDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                event.preventDefault();
                if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const file = event.dataTransfer.files[0];
                if (file && !busy) void importFile(file);
              }}
            >
              <span className="drop-icon">
                <UploadIcon />
              </span>
              {progress ? (
                <span className="import-status">
                  <strong>{progress.label}</strong>
                  <span className="import-progress">
                    <span style={{ width: `${Math.round((progress.fraction ?? 0.08) * 100)}%` }} />
                  </span>
                </span>
              ) : (
                <>
                  <strong>Drop a book or document here</strong>
                  <span>or click to choose a file</span>
                </>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT_ATTRIBUTE}
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importFile(file);
                event.currentTarget.value = "";
              }}
            />
            <div className="format-list">
              <span>EPUB</span>
              <span>PDF</span>
              <span>DOCX</span>
              <span>HTML</span>
              <span>RTF</span>
              <span>MD</span>
              <span>TXT</span>
            </div>
            <p className="import-note">
              Text-based PDFs work directly. Scanned pages need OCR first.
            </p>
          </>
        ) : (
          <div className="paste-form">
            <div className="field-row">
              <label>
                <span>Title</span>
                <input
                  className="field"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Optional"
                  autoFocus
                />
              </label>
              <label>
                <span>Author</span>
                <input
                  className="field"
                  value={author}
                  onChange={(event) => setAuthor(event.target.value)}
                  placeholder="Optional"
                />
              </label>
            </div>
            <label>
              <span>Text</span>
              <textarea
                className="field"
                rows={10}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Paste an article, chapter, notes, or any text you want to hear…"
              />
            </label>
            <div className="modal-actions">
              <span>{text.trim() ? `${text.trim().split(/\s+/).length.toLocaleString()} words` : ""}</span>
              <button className="button primary" onClick={importPaste} disabled={!text.trim()}>
                Add to Library
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="inline-error" role="alert">
            <strong>Couldn’t import this file</strong>
            <span>{error}</span>
          </div>
        )}
      </section>
    </div>
  );
}
