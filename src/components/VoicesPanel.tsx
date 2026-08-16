import { useEffect, useState } from "react";
import { listVoices, VoiceSort } from "../lib/fish";
import { isMissingKeyError } from "../lib/account";
import { session } from "../lib/session";
import { prefs, SavedVoice, slim } from "../lib/prefs";
import { orbStyle } from "../lib/orb";
import { voicePreview } from "../lib/preview";
import { CheckIcon, CloseIcon, HeartIcon, SearchIcon } from "./Icons";

type Tab = "Recent" | "Favorites" | "Explore" | "Created";

const PAGE_SIZE = 40;

const LANGUAGES: [string, string][] = [
  ["", "All languages"],
  ["en", "English"],
  ["el", "Greek"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["nl", "Dutch"],
  ["pl", "Polish"],
  ["ru", "Russian"],
  ["ar", "Arabic"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh", "Chinese"],
];

const SORTS: [VoiceSort, string][] = [
  ["score", "Hot"],
  ["task_count", "Most used"],
  ["created_at", "Newest"],
];

/** curated quick filters — real, high-volume tags in the Fish catalog */
const QUICK_TAGS = [
  "male",
  "female",
  "narration",
  "audiobook",
  "deep",
  "calm",
  "warm",
  "energetic",
  "british",
  "character-voice",
  "dramatic",
  "asmr",
];

const STOPWORDS = new Set(["a", "an", "the", "and", "or", "of", "voice", "voices", "with", "for"]);

/** words in a free-text query that are worth trying as tags */
function tagWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .slice(0, 3);
}

interface Props {
  open: boolean;
  currentVoiceId?: string;
  onSelect: (v: SavedVoice) => void;
  onClose: () => void;
}

/** Never show a raw backend string. A rejected key is escalated so the app can
 *  offer the reconnect screen instead of a dead end. */
function reportVoiceError(reason: unknown, setError: (msg: string) => void) {
  const raw = String(reason ?? "");
  if (isMissingKeyError(raw)) {
    session.reportError(raw);
    setError("Reconnect your Fish Audio account to browse voices.");
    return;
  }
  setError(raw.replace(/^Error:\s*/, "") || "Something went wrong loading voices.");
}

export function VoicesPanel({ open, currentVoiceId, onSelect, onClose }: Props) {
  // a first-time user routed here to pick a voice would otherwise land on an
  // empty "Recent" list at exactly the moment they need choices
  const [tab, setTab] = useState<Tab>(() =>
    prefs.recents().length > 0 ? "Recent" : prefs.favorites().length > 0 ? "Favorites" : "Explore",
  );
  const [search, setSearch] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [language, setLanguage] = useState("");
  const [sort, setSort] = useState<VoiceSort>("score");
  const [explore, setExplore] = useState<SavedVoice[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [created, setCreated] = useState<SavedVoice[]>([]);
  const [favorites, setFavorites] = useState<SavedVoice[]>(prefs.favorites());
  const [recents, setRecents] = useState<SavedVoice[]>(prefs.recents());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState(voicePreview.current());

  // one preview app-wide: reflect the shared state, silence when hidden/gone
  useEffect(() => voicePreview.subscribe(setPreviewing), []);
  useEffect(() => {
    if (!open) voicePreview.stop();
  }, [open]);
  useEffect(() => () => voicePreview.stop(), []);

  useEffect(() => {
    if (!open) return;
    setRecents(prefs.recents());
    setFavorites(prefs.favorites());
    if (tab === "Explore" && explore.length === 0) void loadExplore(1);
    if (tab === "Created") void loadCreated();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  // search/filter changes restart Explore from page 1 (debounced)
  useEffect(() => {
    if (tab !== "Explore") return;
    const t = setTimeout(() => void loadExplore(1), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, language, sort, activeTags]);

  /**
   * The search engine. Fish's `title` param only matches names, so a query
   * like "deep male narrator" finds nothing by title — but voices are TAGGED.
   * Free-text searches therefore run title + tag lookups in parallel and
   * merge; chip filters pass tags directly (ANDed server-side).
   */
  async function loadExplore(page: number) {
    setLoading(true);
    setError("");
    try {
      const q = search.trim();
      const base = {
        language: language || undefined,
        sortBy: sort,
        pageSize: PAGE_SIZE,
        pageNumber: page,
      };

      let items: SavedVoice[] = [];
      let totalCount = 0;

      if (activeTags.length > 0 || !q) {
        const res = await listVoices({
          ...base,
          title: q || undefined,
          tags: activeTags.length > 0 ? activeTags : undefined,
        });
        items = res.items.map(slim);
        totalCount = res.total;
      } else {
        const words = tagWords(q);
        const [byTitle, byTags] = await Promise.all([
          listVoices({ ...base, title: q }),
          words.length > 0
            ? listVoices({ ...base, tags: words })
            : Promise.resolve({ total: 0, items: [] }),
        ]);
        const seen = new Set<string>();
        for (const v of [...byTitle.items, ...byTags.items]) {
          if (!seen.has(v._id)) {
            seen.add(v._id);
            items.push(slim(v));
          }
        }
        totalCount = Math.max(byTitle.total, byTags.total);
      }

      setExplore((prev) => {
        if (page === 1) return items;
        const have = new Set(prev.map((v) => v.id));
        return [...prev, ...items.filter((v) => !have.has(v.id))];
      });
      setTotal(totalCount);
      setPageNum(page);
    } catch (e) {
      reportVoiceError(e, setError);
    } finally {
      setLoading(false);
    }
  }

  function toggleTag(tag: string) {
    setActiveTags((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]));
  }

  async function loadCreated() {
    setLoading(true);
    setError("");
    try {
      const page = await listVoices({ selfOnly: true, pageSize: 50 });
      setCreated(page.items.map(slim));
    } catch (e) {
      reportVoiceError(e, setError);
    } finally {
      setLoading(false);
    }
  }

  function preview(v: SavedVoice) {
    if (!v.sample) return;
    voicePreview.toggle(v.id, v.sample, setError);
  }

  function toggleFav(v: SavedVoice) {
    setFavorites(prefs.toggleFavorite(v));
  }

  function select(v: SavedVoice) {
    voicePreview.stop();
    setRecents(prefs.pushRecent(v));
    prefs.setDefaultVoice(v);
    onSelect(v);
  }

  const lists: Record<Tab, SavedVoice[]> = {
    Recent: recents,
    Favorites: favorites,
    Explore: explore,
    Created: created,
  };
  const list = lists[tab];

  return (
    <aside className={`voices-panel ${open ? "open" : ""}`} aria-hidden={!open}>
      <header>
        <h2>Voices</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close voice picker">
          <CloseIcon />
        </button>
      </header>

      <div className="tabs">
        {(["Recent", "Favorites", "Explore", "Created"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Explore" && (
        <>
          <div className="search panel-search">
            <SearchIcon />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Try “deep male narrator” or a name…"
            />
          </div>
          <div className="tag-chips">
            {QUICK_TAGS.map((tag) => (
              <button
                key={tag}
                className={`tag-chip ${activeTags.includes(tag) ? "on" : ""}`}
                onClick={() => toggleTag(tag)}
              >
                {tag.replace("-voice", "")}
              </button>
            ))}
          </div>
          <div className="selects-row">
            <select className="mini-select" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            <select
              className="mini-select"
              value={sort}
              onChange={(e) => setSort(e.target.value as VoiceSort)}
            >
              {SORTS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            {total > 0 && <span className="muted small total-count">{total.toLocaleString()} voices</span>}
          </div>
        </>
      )}

      {error && <p className="inline-panel-error">{error}</p>}
      {loading && (
        <div className="voice-skeletons" aria-label="Loading voices">
          <span />
          <span />
          <span />
        </div>
      )}
      {!loading && list.length === 0 && (
        <p className="muted small pad">
          {tab === "Recent" && "Voices you use appear here."}
          {tab === "Favorites" && "Tap the ♥ on any voice to keep it here."}
          {tab === "Explore" && "No voices found."}
          {tab === "Created" && "Voices you clone on Fish Audio appear here."}
        </p>
      )}

      <div className="voice-list">
        {list.map((v) => {
          const fav = favorites.some((f) => f.id === v.id);
          const selected = v.id === currentVoiceId;
          return (
            <div key={v.id} className={`voice-row ${selected ? "selected" : ""}`}>
              <button className="orb" style={orbStyle(v.id)} title="Preview" onClick={() => preview(v)}>
                {v.sample ? (previewing === v.id ? "◼" : "▶") : ""}
              </button>
              <button className="voice-meta" onClick={() => select(v)}>
                <strong>{v.title}</strong>
                <span>{v.description || "—"}</span>
                {v.tags.length > 0 && (
                  <span className="voice-tags">
                    {v.tags.slice(0, 4).map((t) => (
                      <em key={t}>{t}</em>
                    ))}
                  </span>
                )}
              </button>
              {selected && (
                <span className="check" title="Current voice">
                  <CheckIcon />
                </span>
              )}
              <button
                className={`heart ${fav ? "on" : ""}`}
                onClick={() => toggleFav(v)}
                aria-label={fav ? `Remove ${v.title} from saved voices` : `Save ${v.title}`}
              >
                <HeartIcon filled={fav} />
              </button>
            </div>
          );
        })}
        {tab === "Explore" && explore.length > 0 && explore.length < total && (
          <button className="button secondary load-more" disabled={loading} onClick={() => void loadExplore(pageNum + 1)}>
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </aside>
  );
}
