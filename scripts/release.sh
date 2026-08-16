#!/bin/bash
# Fish Reader release pipeline.
#
#   npm run release 0.2.1
#
# Bumps the version everywhere, builds a SIGNED app + updater artifacts,
# writes latest.json, commits + tags, and publishes a GitHub release.
# Installed apps see the new version on their next launch and self-update.
set -euo pipefail

VERSION="${1:?usage: npm run release <version, e.g. 0.2.1>}"
REPO="Mornify/fish-reader"
KEY_PATH="$HOME/.tauri/fish-reader.key"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "version must look like 1.2.3"; exit 1; }
[[ -f "$KEY_PATH" ]] || { echo "signing key missing at $KEY_PATH"; exit 1; }

echo "▸ bumping version to $VERSION"
node -e "
const fs = require('fs');
for (const f of ['package.json']) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8')); j.version = '$VERSION';
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
}
const conf = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
conf.version = '$VERSION';
fs.writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(conf, null, 2) + '\n');
"
export PATH="$HOME/.cargo/bin:$PATH"

echo "▸ building signed release"
TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
npm run tauri build

BUNDLE="src-tauri/target/release/bundle/macos"
APP="$BUNDLE/Fish Reader.app"
ARCHIVE_SRC="$BUNDLE/Fish Reader.app.tar.gz"
SIG_SRC="$ARCHIVE_SRC.sig"
[[ -f "$ARCHIVE_SRC" && -f "$SIG_SRC" ]] || { echo "updater artifacts missing — is createUpdaterArtifacts on?"; exit 1; }

# Tauri leaves a "linker-signed" ad-hoc signature that FAILS codesign
# verification. macOS then reports a downloaded copy as "damaged", which
# right-click → Open cannot bypass. A proper ad-hoc re-sign makes the
# signature valid, so unnotarized downloads get the normal (bypassable)
# "unidentified developer" prompt instead.
echo "▸ re-signing the app bundle"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP" || { echo "signature still invalid — aborting"; exit 1; }
echo "  signature verified"

# The tarball Tauri built contains the OLD signature, so rebuild it from the
# re-signed app and re-sign it for the updater.
echo "▸ rebuilding + signing the updater archive"
rm -f "$ARCHIVE_SRC" "$SIG_SRC"
tar -czf "$ARCHIVE_SRC" -C "$BUNDLE" "Fish Reader.app"
TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
npm run tauri signer sign -- "$ARCHIVE_SRC" >/dev/null
[[ -f "$SIG_SRC" ]] || { echo "updater signature missing — aborting"; exit 1; }

ASSET="Fish-Reader_${VERSION}_aarch64.app.tar.gz"
cp "$ARCHIVE_SRC" "/tmp/$ASSET"

# Humans get a double-clickable zip (the tar.gz above is the updater format).
# The name is version-less so the landing page can link to a stable URL:
# /releases/latest/download/Fish-Reader-macOS.zip
echo "▸ packaging Fish-Reader-macOS.zip"
rm -f "/tmp/Fish-Reader-macOS.zip"
ditto -c -k --keepParent "$APP" "/tmp/Fish-Reader-macOS.zip"

echo "▸ writing latest.json"
SIGNATURE="$(cat "$SIG_SRC")" ASSET="$ASSET" VERSION="$VERSION" node -e "
const fs = require('fs');
fs.writeFileSync('/tmp/latest.json', JSON.stringify({
  version: process.env.VERSION,
  notes: 'Fish Reader v' + process.env.VERSION,
  pub_date: new Date().toISOString(),
  platforms: {
    'darwin-aarch64': {
      signature: process.env.SIGNATURE,
      url: 'https://github.com/$REPO/releases/download/v' + process.env.VERSION + '/' + process.env.ASSET,
    },
  },
}, null, 2));
"

echo "▸ committing + tagging v$VERSION"
git add -A
git commit -m "release v$VERSION" || true
git tag "v$VERSION"
git push origin main --tags

echo "▸ publishing GitHub release"
gh release create "v$VERSION" \
  --repo "$REPO" \
  --title "Fish Reader v$VERSION" \
  --notes "Fish Reader v$VERSION" \
  "/tmp/$ASSET" "/tmp/latest.json" "/tmp/Fish-Reader-macOS.zip"

echo "✅ v$VERSION published — installed apps will offer the update on next launch."
echo "   (Your local /Applications copy: cp -R \"$BUNDLE/Fish Reader.app\" /Applications/)"
