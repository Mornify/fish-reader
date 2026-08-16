# Your build vs. the public build

There is exactly **one** codebase and one release. The difference between your
copy and everyone else's is *where the key lives*, not what gets compiled.

## The public build — what goes on GitHub

Contains **no key of any kind**. On first launch a stranger sees onboarding,
pastes their own Fish Audio key, and it is stored on *their* Mac at
`~/Library/Application Support/com.fish-reader.app/config.json` with `0600`
permissions (owner-read-only). Their key never reaches you, this repo, or any
server.

This is the only safe design for a public download. A key compiled into a
distributed binary is not a secret: anyone can pull it out with `strings`, and
every download would be spending *your* Fish Audio credit.

`scripts/check-secrets.sh` runs inside `npm run release` and **aborts the
release** if any credential appears in the build. It matches both the shape of
a Fish key (32 hex characters near an auth-ish word) and, specifically, the key
in your local `.env` — so a mistake fails the build instead of shipping.

## Your build — the convenience

Put your key in `.env` at the repo root (already gitignored, never committed —
verified: it has never appeared in this repo's git history):

```
FISH_API_KEY=your_key_here
```

In development (`npm run tauri dev`) the app reads it so you skip onboarding.
It is loaded under `#[cfg(debug_assertions)]` only, so it is compiled **out** of
release builds entirely — a release binary cannot read `.env` even if one is
sitting next to it.

If you want your key in your own *installed* app, don't rebuild anything —
just launch the public build once and paste it into onboarding. It lands in the
same 0600 config file. Identical binary, your key, zero leak risk.

## If a key is ever exposed

Rotate it at <https://fish.audio/app/developers>. Rotation is the only real
remedy: a published binary or a git commit cannot be un-downloaded.
