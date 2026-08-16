import { useEffect, useMemo, useState } from "react";
import { Book } from "../types";
import { bookProgress, estimateMinutes, formatDuration, wordsIn } from "../lib/books";
import { MoreIcon, PlayIcon, PlusIcon, SearchIcon, TrashIcon } from "./Icons";

interface Props {
  books: Book[];
  query: string;
  onQuery: (query: string) => void;
  onImport: () => void;
  onOpen: (book: Book) => void;
  onDelete: (book: Book) => void;
}

export function Library({ books, query, onQuery, onImport, onOpen, onDelete }: Props) {
  const [menuBookId, setMenuBookId] = useState<string | null>(null);
  const [confirmBookId, setConfirmBookId] = useState<string | null>(null);
  const normalized = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      books.filter(
        (book) =>
          !normalized ||
          book.title.toLowerCase().includes(normalized) ||
          book.author?.toLowerCase().includes(normalized),
      ),
    [books, normalized],
  );
  const totalWords = useMemo(
    () => books.reduce((sum, book) => sum + wordsIn(book.text), 0),
    [books],
  );

  // a menu that only closes via its own button feels broken — dismiss on any
  // outside click or Escape, like every native context menu
  useEffect(() => {
    if (!menuBookId) return;
    const dismiss = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof MouseEvent &&
        (event.target as HTMLElement)?.closest(".book-menu-wrap")
      ) {
        return;
      }
      setMenuBookId(null);
      setConfirmBookId(null);
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [menuBookId]);

  return (
    <main className="main-col view-enter">
      <header className="topbar titlebar-pad" data-tauri-drag-region>
        <label className="search">
          <SearchIcon />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search your library"
          />
          {query && (
            <button className="search-clear" onClick={() => onQuery("")} aria-label="Clear search">
              Clear
            </button>
          )}
        </label>
        <button className="button secondary compact" onClick={onImport}>
          <PlusIcon /> Import
        </button>
      </header>

      <div className="page library-page">
        <section className="page-heading">
          <div>
            <h1>Library</h1>
            <p className="library-stat">
              {books.length} {books.length === 1 ? "book" : "books"} · {totalWords.toLocaleString()} words
            </p>
          </div>
        </section>

        {filtered.length === 0 ? (
          <EmptyLibrary hasBooks={books.length > 0} query={query} onImport={onImport} />
        ) : (
          <section className="book-list" aria-label={normalized ? "Search results" : "All books"}>
            {filtered.map((book) => {
              const progress = bookProgress(book);
              const menuOpen = menuBookId === book.id;
              const confirming = confirmBookId === book.id;
              return (
                <article key={book.id} className="book-row">
                  <div className="book-info">
                    <h2>{book.title}</h2>
                    {book.author && <p className="muted">{book.author}</p>}
                    <p className="muted small">
                      {progress > 0 ? `${progress}% · ` : ""}
                      {formatDuration(estimateMinutes(book.text.length))}
                    </p>

                    <div className="book-actions">
                      <button className="button primary" onClick={() => onOpen(book)}>
                        <PlayIcon />
                        {progress > 0 ? "Continue" : "Play"}
                      </button>
                      <div className="book-menu-wrap">
                        <button
                          className="round-btn"
                          onClick={() => {
                            setMenuBookId(menuOpen ? null : book.id);
                            setConfirmBookId(null);
                          }}
                          aria-label={`Book options for ${book.title}`}
                          aria-expanded={menuOpen}
                        >
                          <MoreIcon />
                        </button>
                        {menuOpen && (
                          <div className="context-menu">
                            {confirming ? (
                              <>
                                <p>Remove this book?</p>
                                <div>
                                  <button className="text-button" onClick={() => setConfirmBookId(null)}>
                                    Cancel
                                  </button>
                                  <button
                                    className="text-button danger"
                                    onClick={() => {
                                      onDelete(book);
                                      setMenuBookId(null);
                                      setConfirmBookId(null);
                                    }}
                                  >
                                    Remove
                                  </button>
                                </div>
                              </>
                            ) : (
                              <button className="menu-item danger" onClick={() => setConfirmBookId(book.id)}>
                                <TrashIcon /> Remove from library
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <BookCover book={book} onClick={() => onOpen(book)} />
                </article>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}

function BookCover({ book, onClick }: { book: Book; onClick: () => void }) {
  const tone = Math.floor(book.hue / 45) % 8;
  return (
    <button
      className={`book-cover tone-${tone}`}
      onClick={onClick}
      aria-label={`Open ${book.title}`}
    >
      <span>{book.title}</span>
    </button>
  );
}

function EmptyLibrary({
  hasBooks,
  query,
  onImport,
}: {
  hasBooks: boolean;
  query: string;
  onImport: () => void;
}) {
  return (
    <section className={`empty-state library-empty ${hasBooks ? "search-empty" : ""}`}>
      <h2>{hasBooks ? `Nothing found for “${query}”` : "Nothing here yet."}</h2>
      <p>
        {hasBooks
          ? "Try another title or author."
          : "Import EPUB, PDF, DOCX, HTML, RTF, Markdown, plain text, or paste anything."}
      </p>
      {!hasBooks && (
        <button className="button primary" onClick={onImport}>
          <PlusIcon /> Import your first book
        </button>
      )}
    </section>
  );
}
