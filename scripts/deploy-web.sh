#!/bin/bash
# Publish the landing page + web app to the gh-pages branch.
#
#   /            landing page (web/) — download links only.
#
# The reader itself is NOT published here: Pages is static, so the narration
# relay at /api/* cannot exist and every play failed with error 405.
#
# Uses a detached worktree so the working tree is never disturbed.
#
# This script deliberately does NOT hide git's output. An earlier version ran
# `git checkout --orphan gh-pages-tmp >/dev/null 2>&1`; once a run aborted and
# left that branch behind, every later deploy failed on the name collision,
# `set -e` killed the script *before the push*, and the swallowed stderr meant
# it looked like it had worked. The site served a stale build for days. Hence:
# unique branch name, cleanup on exit, visible errors, and a final check that
# the bytes we just built are the bytes actually being served.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SITE_URL="https://mornify.github.io/fish-reader"
TMP_BRANCH="gh-pages-deploy-$$"
OUT=""
WORKTREE=""

cleanup() {
  cd "$ROOT"
  [ -n "$WORKTREE" ] && [ -d "$WORKTREE" ] && git worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true
  git branch -D "$TMP_BRANCH" >/dev/null 2>&1 || true
  git worktree prune >/dev/null 2>&1 || true
  [ -n "$OUT" ] && rm -rf "$OUT" || true
}
trap cleanup EXIT

# a previous aborted run can leave these behind; they are ours to clear
git worktree prune >/dev/null 2>&1 || true
git branch -D gh-pages-tmp >/dev/null 2>&1 || true

echo "▸ stamping asset versions"
node scripts/version-web.mjs

# GitHub Pages is a static host with no functions, so the reader's narration
# relay (/api/*) cannot exist there — every play returned "error 405". Rather
# than publish a copy of the app that can never narrate, Pages now serves only
# the landing page and points at the Mac download. The working web app lives on
# Vercel, where the relay is a real function.

OUT="$(mktemp -d)"
cp -R web/. "$OUT/"

# GitHub Pages runs Jekyll by default and skips files starting with "_"
touch "$OUT/.nojekyll"

echo "▸ publishing to gh-pages"
WORKTREE="$(mktemp -d)"
git worktree add --detach "$WORKTREE" >/dev/null
(
  cd "$WORKTREE"
  git checkout --orphan "$TMP_BRANCH" >/dev/null
  git rm -rf . >/dev/null 2>&1 || true
  cp -R "$OUT/." .
  git add -A
  git -c user.name="$(git config user.name)" -c user.email="$(git config user.email)" \
      commit -q -m "Deploy site + web app"
  git push --force origin "HEAD:gh-pages"
)

echo "▸ waiting for GitHub Pages to serve the new build"
# Pages rebuilds asynchronously; "deployed" only means something once the new
# page is the one being served.
#
# Compare a hash of index.html itself, NOT just the bundle filename. A change
# that touches only the HTML — a meta tag, a CSP, a title — leaves the asset
# hash identical, so an asset-only check reports success against a stale page.
# That happened: the CSP was verified "live" while Pages was still serving the
# previous HTML.
EXPECTED_SHA="$(shasum -a 256 "$OUT/index.html" | cut -d' ' -f1)"

for attempt in $(seq 1 40); do
  live_sha="$(curl -fsS -H 'Cache-Control: no-cache' "$SITE_URL/?cb=$attempt" 2>/dev/null \
              | shasum -a 256 | cut -d' ' -f1 || true)"
  if [ "$live_sha" = "$EXPECTED_SHA" ]; then
    echo "✅ deployed and verified live → $SITE_URL/"
    exit 0
  fi
  sleep 3
done

echo "⚠️  pushed, but $SITE_URL/ is still serving an older page." >&2
echo "    Expected index.html sha256 $EXPECTED_SHA" >&2
echo "    Last seen                  ${live_sha:-<no response>}" >&2
echo "    GitHub Pages can lag a few minutes — re-check before assuming failure." >&2
exit 1
