/* Fish Reader landing page — no dependencies, no tracking. */

/* ------------------------------------------------------------------ *
 * Waitlist
 *
 * Set WAITLIST_ENDPOINT to a form endpoint (e.g. a free Formspree form:
 * https://formspree.io/f/xxxxxxx) to collect emails. Until one is set the
 * form falls back to opening the visitor's mail client, so the button is
 * never a dead end.
 * ------------------------------------------------------------------ */
const WAITLIST_ENDPOINT = "";
const CONTACT_EMAIL = "alekos7771@gmail.com";

const form = document.getElementById("waitlist");
const note = document.getElementById("waitlist-note");

function setNote(text, kind) {
  note.textContent = text;
  note.className = "waitlist-note" + (kind ? " " + kind : "");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("email").value.trim();
  if (!email) return;

  if (!WAITLIST_ENDPOINT) {
    window.location.href =
      "mailto:" +
      CONTACT_EMAIL +
      "?subject=" +
      encodeURIComponent("Fish Reader updates") +
      "&body=" +
      encodeURIComponent("Please add me to the Fish Reader update list: " + email);
    setNote("Opening your mail app to confirm…");
    return;
  }

  const button = form.querySelector("button");
  button.disabled = true;
  setNote("Adding you…");
  try {
    const res = await fetch(WAITLIST_ENDPOINT, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error("bad status");
    form.reset();
    setNote("You're on the list. Talk soon.", "ok");
  } catch {
    setNote("That didn't go through — email " + CONTACT_EMAIL + " instead.", "err");
  } finally {
    button.disabled = false;
  }
});

/* ------------------------------------------------------------------ *
 * Show the real latest version next to the download button
 * ------------------------------------------------------------------ */
fetch("https://api.github.com/repos/Mornify/fish-reader/releases/latest")
  .then((r) => (r.ok ? r.json() : Promise.reject()))
  .then((release) => {
    if (!release || !release.tag_name) return;
    const meta = document.getElementById("release-meta");
    if (meta) meta.textContent = release.tag_name + " · Apple Silicon · free";
  })
  .catch(() => {
    /* offline or rate-limited — the static label stays */
  });

/* ------------------------------------------------------------------ *
 * Animated karaoke demo — the product's core idea, shown not told.
 * Renders sentences word by word with the same timing feel as the app.
 * ------------------------------------------------------------------ */
const SENTENCES = [
  "The storm came before the boy did.",
  "It tore the valley open and left the sky bleeding light for three days.",
  "Nobody in the village slept.",
  "When the light finally faded, Kaien was standing in the wheat field.",
];

const host = document.getElementById("demo-text");
const fill = document.getElementById("demo-fill");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// build spans once, then only toggle classes while animating
const model = SENTENCES.map((text) => {
  const sentence = document.createElement("span");
  sentence.className = "sent";
  const words = text.split(" ").map((word, index) => {
    const el = document.createElement("span");
    el.className = "w";
    el.textContent = index === 0 ? word : " " + word;
    sentence.appendChild(el);
    return el;
  });
  host.appendChild(sentence);
  host.appendChild(document.createTextNode(" "));
  return { sentence, words };
});

const totalWords = model.reduce((sum, s) => sum + s.words.length, 0);

if (reduceMotion) {
  // static, accessible preview: show the effect without motion
  model[1].sentence.classList.add("on");
  model[0].sentence.classList.add("done");
  model[1].words[4].classList.add("on");
  fill.style.width = "38%";
} else {
  let sentenceIndex = 0;
  let wordIndex = 0;
  let spoken = 0;

  const step = () => {
    const current = model[sentenceIndex];
    current.sentence.classList.add("on");
    current.words.forEach((w) => w.classList.remove("on"));
    current.words[wordIndex].classList.add("on");

    spoken++;
    fill.style.width = Math.min(100, (spoken / totalWords) * 100) + "%";

    // longer words linger, like real speech
    const word = current.words[wordIndex].textContent.trim();
    const delay = 150 + Math.min(word.length, 12) * 26;

    wordIndex++;
    if (wordIndex >= current.words.length) {
      wordIndex = 0;
      current.words.forEach((w) => w.classList.remove("on"));
      current.sentence.classList.remove("on");
      current.sentence.classList.add("done");
      sentenceIndex++;

      if (sentenceIndex >= model.length) {
        // reset the loop after a beat
        setTimeout(() => {
          model.forEach((s) => {
            s.sentence.classList.remove("done", "on");
            s.words.forEach((w) => w.classList.remove("on"));
          });
          sentenceIndex = 0;
          spoken = 0;
          fill.style.width = "0%";
          setTimeout(step, 500);
        }, 1400);
        return;
      }
      setTimeout(step, 420);
      return;
    }
    setTimeout(step, delay);
  };

  setTimeout(step, 700);
}
