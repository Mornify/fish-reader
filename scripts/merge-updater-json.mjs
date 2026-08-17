#!/usr/bin/env node
/**
 * Add a platform to the updater manifest without losing the others.
 *
 * latest.json lists one entry per platform. macOS is released from the
 * maintainer's Mac (it needs a local re-signing step that CI cannot do without
 * an Apple certificate), while Windows is built on a GitHub runner. So the two
 * halves arrive separately, and a naive "write latest.json" from either side
 * would silently delete the other platform's entry — every Mac install would
 * stop seeing updates the first time a Windows build shipped.
 *
 * Usage:
 *   node scripts/merge-updater-json.mjs <existing.json|-> <platform> <url> <sigfile> <version>
 *
 * Prints the merged manifest to stdout. Pass "-" when there is no existing
 * manifest yet.
 */
import { readFileSync } from "node:fs";

const [, , existingPath, platform, url, sigPath, version] = process.argv;

if (!platform || !url || !sigPath || !version) {
  console.error(
    "usage: merge-updater-json.mjs <existing.json|-> <platform> <url> <sigfile> <version>",
  );
  process.exit(1);
}

let manifest = { version, notes: `Fish Reader v${version}`, platforms: {} };

if (existingPath && existingPath !== "-") {
  try {
    const parsed = JSON.parse(readFileSync(existingPath, "utf8"));
    if (parsed && typeof parsed === "object") {
      manifest = { ...manifest, ...parsed, platforms: { ...(parsed.platforms ?? {}) } };
    }
  } catch {
    // A missing or unparseable manifest must not take the release down; we
    // simply start a fresh one rather than aborting the build.
  }
}

// The release being published is authoritative for version/date. Entries from
// an older version are dropped: an updater manifest that advertises v0.3.0 must
// not hand a Mac the v0.2.3 archive.
if (manifest.version !== version) manifest.platforms = {};
manifest.version = version;
manifest.notes = `Fish Reader v${version}`;
manifest.pub_date = new Date().toISOString();

manifest.platforms[platform] = {
  signature: readFileSync(sigPath, "utf8").trim(),
  url,
};

process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
