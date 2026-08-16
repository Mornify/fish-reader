#!/bin/bash
# Publish the landing page + web app to the gh-pages branch.
#
#   /            landing page  (web/)
#   /app/        the reader    (dist-web/)
#
# Uses a detached worktree so the working tree is never disturbed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "▸ stamping asset versions"
node scripts/version-web.mjs

echo "▸ building the web app"
BUILD_TARGET=web npx tsc
BUILD_TARGET=web npx vite build

OUT="$(mktemp -d)"
cp -R web/. "$OUT/"
mkdir -p "$OUT/app"
cp -R dist-web/. "$OUT/app/"

# GitHub Pages runs Jekyll by default and skips files starting with "_"
touch "$OUT/.nojekyll"
# the app is a single-page app; unknown deep links must still boot it
cp "$OUT/app/index.html" "$OUT/app/404.html" 2>/dev/null || true

echo "▸ publishing to gh-pages"
WORKTREE="$(mktemp -d)"
git worktree add --detach "$WORKTREE" >/dev/null 2>&1
cd "$WORKTREE"
git checkout --orphan gh-pages-tmp >/dev/null 2>&1
git rm -rf . >/dev/null 2>&1 || true
cp -R "$OUT/." .
git add -A
git -c user.name="$(git config user.name)" -c user.email="$(git config user.email)" \
    commit -q -m "Deploy site + web app"
git push -q --force origin HEAD:gh-pages
cd "$ROOT"
git worktree remove --force "$WORKTREE" >/dev/null 2>&1
rm -rf "$OUT"
echo "✅ deployed → https://mornify.github.io/fish-reader/  (app at /app/)"
