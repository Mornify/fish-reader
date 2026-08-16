#!/bin/bash
# Refuse to publish anything containing a credential.
#
# The public build must never carry Alekos's Fish Audio key. Users bring their
# own key, entered at onboarding and stored locally — so a key appearing in a
# build artifact is always a mistake, and always one that would be irreversible
# once a release is downloaded. This runs before any artifact is published.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGETS=("$@")
if [ ${#TARGETS[@]} -eq 0 ]; then
  TARGETS=(dist dist-web src-tauri/target/release/bundle web)
fi

# A Fish Audio key is 32 lowercase hex characters. Matching the shape rather
# than one known value also catches a *different* key pasted in by mistake.
PATTERN='[0-9a-f]{32}'
FOUND=0

for target in "${TARGETS[@]}"; do
  [ -e "$target" ] || continue
  while IFS= read -r -d '' file; do
    # binaries and lockfiles are full of legitimate 32-hex hashes
    case "$file" in
      *.png|*.jpg|*.jpeg|*.icns|*.ico|*.woff|*.woff2|*.map|*Cargo.lock|*package-lock.json) continue ;;
    esac
    if LC_ALL=C grep -aoE "$PATTERN" "$file" 2>/dev/null | grep -qE '^[0-9a-f]{32}$'; then
      # a hex string next to an api-key-ish word is what actually matters
      if LC_ALL=C grep -aiE "(api[_-]?key|authorization|bearer|fish[_-]?key)" "$file" >/dev/null 2>&1; then
        echo "✗ possible credential in $file" >&2
        FOUND=1
      fi
    fi
  done < <(find "$target" -type f -print0 2>/dev/null)
done

# and never allow the developer's own key, wherever it came from
if [ -f .env ]; then
  DEV_KEY="$(grep -oE '[0-9a-f]{32}' .env 2>/dev/null | head -1 || true)"
  if [ -n "$DEV_KEY" ]; then
    for target in "${TARGETS[@]}"; do
      [ -e "$target" ] || continue
      if LC_ALL=C grep -raq "$DEV_KEY" "$target" 2>/dev/null; then
        echo "✗ YOUR OWN Fish Audio key from .env appears inside $target" >&2
        FOUND=1
      fi
    done
  fi
fi

if [ "$FOUND" -ne 0 ]; then
  echo "" >&2
  echo "Release aborted. Nothing was published." >&2
  exit 1
fi
echo "✓ no credentials found in: ${TARGETS[*]}"
