import { useEffect, useMemo, useState } from "react";
import { orbStyle } from "../lib/orb";
import { prefs, SavedVoice } from "../lib/prefs";
import { voicePreview } from "../lib/preview";
import { CheckIcon, HeartIcon, PlusIcon, SearchIcon, WaveIcon } from "./Icons";
import { VoicesPanel } from "./VoicesPanel";

export function VoicesLibrary() {
  const [favorites, setFavorites] = useState<SavedVoice[]>(prefs.favorites());
  const [defaultVoice, setDefaultVoice] = useState<SavedVoice | null>(prefs.defaultVoice());
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewing, setPreviewing] = useState(voicePreview.current());

  // shared preview state; silence anything still playing when this page unmounts
  useEffect(() => voicePreview.subscribe(setPreviewing), []);
  useEffect(() => () => voicePreview.stop(), []);
  const filtered = useMemo(() => {
    const clean = query.trim().toLowerCase();
    return favorites.filter(
      (voice) =>
        !clean ||
        voice.title.toLowerCase().includes(clean) ||
        voice.description.toLowerCase().includes(clean) ||
        voice.tags.some((tag) => tag.toLowerCase().includes(clean)),
    );
  }, [favorites, query]);

  useEffect(() => {
    const refresh = () => {
      setFavorites(prefs.favorites());
      setDefaultVoice(prefs.defaultVoice());
    };
    window.addEventListener("fish-reader:prefs", refresh);
    return () => window.removeEventListener("fish-reader:prefs", refresh);
  }, []);

  function choose(voice: SavedVoice) {
    voicePreview.stop();
    prefs.setDefaultVoice(voice);
    prefs.pushRecent(voice);
    setDefaultVoice(voice);
    setPickerOpen(false);
  }

  function preview(voice: SavedVoice) {
    if (!voice.sample) return;
    voicePreview.toggle(voice.id, voice.sample);
  }

  return (
    <main className="main-col view-enter">
      <header className="topbar titlebar-pad" data-tauri-drag-region>
        <label className="search">
          <SearchIcon />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search saved voices"
            aria-label="Search saved voices"
          />
        </label>
        <button className="button secondary compact" onClick={() => setPickerOpen(true)}>
          <PlusIcon /> Find voices
        </button>
      </header>

      <div className="page voices-page">
        <section className="page-heading">
          <div>
            <h1>Voices</h1>
            <p className="library-stat">
              {favorites.length} saved · one default across new books
            </p>
          </div>
        </section>

        {defaultVoice && (
          <section className="saved-voices-section">
            <h2>Default voice</h2>
            <VoiceRow
              voice={defaultVoice}
              isDefault
              previewing={previewing === defaultVoice.id}
              onPreview={() => preview(defaultVoice)}
              onChoose={() => choose(defaultVoice)}
              onRemove={() => setFavorites(prefs.toggleFavorite(defaultVoice))}
            />
          </section>
        )}

        {filtered.length > 0 ? (
          <section className="saved-voices-section">
            <h2>Saved voices</h2>
            <div className="saved-voice-list">
              {filtered.map((voice) => (
                <VoiceRow
                  key={voice.id}
                  voice={voice}
                  isDefault={defaultVoice?.id === voice.id}
                  previewing={previewing === voice.id}
                  onPreview={() => preview(voice)}
                  onChoose={() => choose(voice)}
                  onRemove={() => setFavorites(prefs.toggleFavorite(voice))}
                />
              ))}
            </div>
          </section>
        ) : (
          <section className="empty-state voices-empty">
            <span className="empty-wave" aria-hidden="true">
              <WaveIcon />
            </span>
            <h2>{favorites.length ? "No matching voices" : "No voices saved yet."}</h2>
            <p>
              {favorites.length
                ? "Try another name, description, or language."
                : "Explore the voice catalog, preview a voice, then use the heart to save it."}
            </p>
            {!favorites.length && (
              <button className="button primary" onClick={() => setPickerOpen(true)}>
                Find a voice
              </button>
            )}
          </section>
        )}
      </div>

      <VoicesPanel
        open={pickerOpen}
        currentVoiceId={defaultVoice?.id}
        onSelect={choose}
        onClose={() => {
          setFavorites(prefs.favorites());
          setPickerOpen(false);
        }}
      />
      {pickerOpen && <button className="panel-scrim" onClick={() => setPickerOpen(false)} aria-label="Close voices" />}
    </main>
  );
}

function VoiceRow({
  voice,
  isDefault,
  previewing,
  onPreview,
  onChoose,
  onRemove,
}: {
  voice: SavedVoice;
  isDefault: boolean;
  previewing: boolean;
  onPreview: () => void;
  onChoose: () => void;
  onRemove: () => void;
}) {
  return (
    <article className={`saved-voice-card ${isDefault ? "selected" : ""}`}>
      <button
        className="orb"
        style={orbStyle(voice.id)}
        onClick={onPreview}
        aria-label={`Preview ${voice.title}`}
        disabled={!voice.sample}
      >
        {voice.sample ? (previewing ? "■" : "▶") : ""}
      </button>
      <button className="voice-meta" onClick={onChoose}>
        <strong>{voice.title}</strong>
        <span>{voice.description || voice.tags.slice(0, 3).join(" · ") || "Saved voice"}</span>
      </button>
      {isDefault && (
        <span className="check" title="Default voice">
          <CheckIcon />
        </span>
      )}
      <button
        className="heart on"
        onClick={onRemove}
        aria-label={`Remove ${voice.title} from saved voices`}
      >
        <HeartIcon filled />
      </button>
    </article>
  );
}
