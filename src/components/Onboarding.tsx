import { useEffect, useState } from "react";
import { listVoices } from "../lib/fish";
import { openExternal, saveApiKey } from "../lib/account";
import { prefs, SavedVoice, slim } from "../lib/prefs";
import { voicePreview } from "../lib/preview";
import { orbStyle } from "../lib/orb";
import { BookIcon, CheckIcon, SparkleIcon, WaveIcon } from "./Icons";

const KEY_URL = "https://fish.audio/go-api/";

interface Props {
  /** which step to start on: full first run, or just reconnecting an account */
  mode?: "full" | "reconnect";
  onDone: () => void;
}

export function Onboarding({ mode = "full", onDone }: Props) {
  const [step, setStep] = useState(mode === "reconnect" ? 1 : 0);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [voices, setVoices] = useState<SavedVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [chosen, setChosen] = useState<string>("");
  const [previewing, setPreviewing] = useState(voicePreview.current());

  useEffect(() => voicePreview.subscribe(setPreviewing), []);
  useEffect(() => () => voicePreview.stop(), []);

  async function connect() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await saveApiKey(key);
      if (mode === "reconnect") {
        onDone();
        return;
      }
      setStep(2);
      void loadVoices();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function loadVoices() {
    setLoadingVoices(true);
    try {
      const page = await listVoices({
        tags: ["narration"],
        language: "en",
        sortBy: "task_count",
        pageSize: 6,
      });
      setVoices(page.items.map(slim));
    } catch {
      setVoices([]);
    } finally {
      setLoadingVoices(false);
    }
  }

  function pick(voice: SavedVoice) {
    setChosen(voice.id);
    prefs.setDefaultVoice(voice);
    prefs.pushRecent(voice);
    // toggle would UN-favourite on a second click of the same voice
    if (!prefs.favorites().some((f) => f.id === voice.id)) prefs.toggleFavorite(voice);
  }

  function finish() {
    voicePreview.stop();
    onDone();
  }

  return (
    <div className="onboarding">
      <div className="onboard-card">
        {step === 0 && (
          <section className="onboard-step">
            <span className="onboard-mark" aria-hidden="true">
              <BookIcon />
            </span>
            <h1>Fish Reader</h1>
            <p className="onboard-lede">
              Turn any book, PDF, or article into an audiobook — and follow along while
              it reads to you.
            </p>
            <ul className="onboard-points">
              <li>
                <WaveIcon /> Thousands of natural voices to narrate with
              </li>
              <li>
                <SparkleIcon /> Every word highlights as it&apos;s spoken
              </li>
              <li>
                <BookIcon /> Your library and progress stay on this Mac
              </li>
            </ul>
            <button className="button primary onboard-cta" onClick={() => setStep(1)}>
              Get started
            </button>
          </section>
        )}

        {step === 1 && (
          <section className="onboard-step">
            <p className="onboard-eyebrow">{mode === "reconnect" ? "Reconnect" : "Step 1 of 2"}</p>
            <h1>Connect Fish Audio</h1>
            <p className="onboard-lede">
              Fish Reader narrates with your own Fish Audio account, so you keep control
              of usage and there&apos;s no middleman. It&apos;s free to start.
            </p>
            <p className="onboard-fineprint onboard-privacy">
              Text you play is sent to Fish Audio to be spoken. Your books, progress and
              saved audio stay on this Mac.
            </p>

            <ol className="onboard-howto">
              <li>
                <button className="link-button" onClick={() => void openExternal(KEY_URL)}>
                  Open fish.audio and create an API key ↗
                </button>
              </li>
              <li>Copy the key and paste it below.</li>
            </ol>

            <input
              className="field onboard-input"
              type="password"
              value={key}
              autoFocus
              spellCheck={false}
              placeholder="Paste your API key"
              onChange={(e) => {
                setKey(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && key.trim() && void connect()}
            />

            {error && (
              <p className="onboard-error" role="alert">
                {error}
              </p>
            )}

            <button
              className="button primary onboard-cta"
              onClick={() => void connect()}
              disabled={!key.trim() || saving}
            >
              {saving ? "Checking…" : "Connect"}
            </button>
            <p className="onboard-fineprint">
              Stored only on this Mac, readable only by your user account.
            </p>
            {/* never trap someone here — offline, or just not ready. They can
                still import and read; narration asks again when they press play */}
            <button className="text-button onboard-skip" onClick={onDone}>
              Skip for now
            </button>
          </section>
        )}

        {step === 2 && (
          <section className="onboard-step">
            <p className="onboard-eyebrow">Step 2 of 2</p>
            <h1>Pick a narrator</h1>
            <p className="onboard-lede">
              Tap a voice to hear it. You can change narrators any time, per book.
            </p>

            <div className="onboard-voices">
              {loadingVoices && <p className="muted small">Loading voices…</p>}
              {!loadingVoices && voices.length === 0 && (
                <p className="muted small">
                  Couldn&apos;t load voices right now — you can choose one later from the
                  player.
                </p>
              )}
              {voices.map((voice) => (
                <div
                  key={voice.id}
                  className={`onboard-voice ${chosen === voice.id ? "chosen" : ""}`}
                >
                  <button
                    className="orb"
                    style={orbStyle(voice.id)}
                    onClick={() =>
                      voice.sample && voicePreview.toggle(voice.id, voice.sample, setError)
                    }
                    aria-label={`Preview ${voice.title}`}
                  >
                    {voice.sample ? (previewing === voice.id ? "◼" : "▶") : ""}
                  </button>
                  <button className="voice-meta" onClick={() => pick(voice)}>
                    <strong>{voice.title}</strong>
                    <span>{voice.description || voice.tags.slice(0, 3).join(" · ")}</span>
                  </button>
                  {chosen === voice.id && (
                    <span className="check">
                      <CheckIcon />
                    </span>
                  )}
                </div>
              ))}
            </div>

            <button className="button primary onboard-cta" onClick={finish}>
              {chosen ? "Start reading" : "Skip for now"}
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
