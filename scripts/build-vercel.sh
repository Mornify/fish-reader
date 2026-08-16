#!/bin/bash
# Assemble the Vercel deployment:
#   /        landing page  (web/)
#   /app/    the reader    (dist-web/)
#   /api/*   narration relay (api/[...path].js — deployed by Vercel, not here)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

node scripts/version-web.mjs
WEB_BASE=/app/ BUILD_TARGET=web npx vite build

rm -rf dist-vercel
mkdir -p dist-vercel
cp -R web/. dist-vercel/
mkdir -p dist-vercel/app
cp -R dist-web/. dist-vercel/app/
# the reader is a single-page app; unknown deep links must still boot it
cp dist-vercel/app/index.html dist-vercel/app/404.html
echo "✅ dist-vercel ready"
