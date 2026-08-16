# Fish Reader narration relay

The web app needs this. The Mac app does not.

## Why it exists

`api.fish.audio` allows browser requests for listing voices, but its **speech
endpoints reject the browser's CORS preflight** (verified: `OPTIONS /v1/tts`
answers `401` with no `Access-Control-Allow-Origin` header). A browser therefore
cannot call them directly, no matter what the page does.

This Worker is the smallest possible fix: it forwards the request and streams the
audio back.

## What it deliberately does not do

- does not store, log or inspect anyone's API key
- does not store or log the text being narrated
- has no database, no accounts, no analytics
- only accepts requests from the app's own origins, so it can't be used as an
  open proxy against someone else's quota

## Deploy (about two minutes, one time)

```sh
cd worker
npx wrangler login      # opens your browser to authorise Cloudflare
npx wrangler deploy
```

Wrangler prints the deployed URL, e.g.
`https://fish-reader-relay.<your-subdomain>.workers.dev`.

If that URL is **not** exactly
`https://fish-reader-relay.mornify.workers.dev`, set it for the web build:

```sh
VITE_RELAY_URL="https://your-actual-url.workers.dev" npm run deploy:web
```

## Verify it works

```sh
curl -i -X OPTIONS https://your-url.workers.dev/v1/tts \
  -H "Origin: https://mornify.github.io" \
  -H "Access-Control-Request-Method: POST"
```

A correct deployment answers `204` with an `Access-Control-Allow-Origin` header.
(The un-relayed endpoint answers `401` with no CORS headers — that is the whole
problem this solves.)

## Cost

Cloudflare's free tier covers 100,000 requests/day. One request is one sentence
of narration, and every sentence is cached in the reader afterwards, so repeat
listening costs nothing. Cloudflare does not charge for egress bandwidth.

## Local development

```sh
node worker/local-relay.mjs   # http://localhost:8787
```
The web app points at this automatically when served from localhost.
