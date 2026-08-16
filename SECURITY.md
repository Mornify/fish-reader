# Security

## Reporting

Email **alekos7771@gmail.com**, or open a private advisory at
<https://github.com/Mornify/fish-reader/security/advisories/new>. Please don't
open a public issue for a vulnerability.

## What this app holds

Fish Reader runs entirely on your own Mac. There is no server, no account and
no telemetry, so there is no central store to breach.

| Thing | Where it lives |
| --- | --- |
| Your Fish Audio API key | `~/Library/Application Support/com.fish-reader.app/config.json`, mode `0600` (owner-read-only) |
| Your books | the same app-support folder, written atomically |
| Generated narration audio | local cache, addressable by content hash |

Your key goes to **api.fish.audio** and nowhere else. The text you press play on
is sent there to be turned into speech — that is how narration works, and it is
stated in onboarding rather than buried here.

## How releases are protected

- Updates are signed with a minisign key that never leaves the maintainer's
  machine, and the app refuses any update that fails signature verification.
- `scripts/check-secrets.sh` runs inside `npm run release` and aborts the
  release if a credential appears in the build, matching both the shape of a
  Fish Audio key and the maintainer's own key from `.env`.
- Builds are not notarized (that needs a paid Apple certificate), so the first
  launch of a downloaded copy requires right-click → Open.

## Known limitations

- Anyone with access to your unlocked Mac account can read the config file. It
  is protected by file permissions, not by encryption at rest.
- The app trusts documents you import. Parsing is done by pdf.js, JSZip and
  mammoth in the renderer; a malicious file is a plausible attack surface, so
  import books you have a reason to trust.
