/**
 * Stamp web/*.html with content hashes for style.css and app.js.
 * Without this, a returning visitor can run yesterday's JavaScript against
 * today's HTML — the classic static-site stale-cache bug.
 * Run before deploying: npm run web:version
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const hash = (f) => createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 8);
const css = hash("web/style.css");
const js = hash("web/app.js");

for (const page of ["web/index.html", "web/privacy.html", "web/terms.html"]) {
  const out = readFileSync(page, "utf8")
    .replace(/href="style\.css(\?v=[a-f0-9]+)?"/g, `href="style.css?v=${css}"`)
    .replace(/src="app\.js(\?v=[a-f0-9]+)?"/g, `src="app.js?v=${js}"`);
  writeFileSync(page, out);
}
console.log(`stamped style.css?v=${css} app.js?v=${js}`);
