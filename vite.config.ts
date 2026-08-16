import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const isWebBuild = process.env.BUILD_TARGET === "web";

// The same React app ships twice:
//   • Tauri desktop  → served from the bundle root
//   • Web app        → served from /fish-reader/app/ on GitHub Pages
// https://vite.dev/config/
// GitHub Pages serves static files and cannot set response headers, so the web
// build carries its policy in a meta tag instead. It is injected only for the
// web target: the desktop app declares its own CSP in tauri.conf.json, and that
// one has to allow Tauri's asset:/ipc: schemes which have no business being in
// a policy served on the public internet.
const WEB_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "script-src 'self'",
  // React sets style attributes (progress fills, drawer transforms) — those are
  // inline styles, so this cannot be tightened without rewriting them as classes
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // pdf.js runs its parser in a worker, and epub/docx parsing uses blob workers
  "worker-src 'self' blob:",
  // narration audio: streamed from the relay, then replayed from IndexedDB blobs
  "media-src 'self' blob: data: https://*.fish.audio https://*.r2.fish.audio",
  // the voice catalogue is fetched from Fish directly; narration goes via relay
  "connect-src 'self' https://api.fish.audio https://*.fish.audio https://fish-reader-relay.mornify.workers.dev",
].join("; ");

const webCspPlugin = {
  name: "fish-reader-web-csp",
  transformIndexHtml(html: string) {
    if (!isWebBuild) return html;
    return html.replace(
      "<head>",
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="${WEB_CSP}" />`,
    );
  },
};

export default defineConfig(async () => ({
  plugins: [react(), webCspPlugin],

  // GitHub Pages serves the project site under a repo subpath, so assets must
  // be requested relative to it. Desktop keeps the root base.
  base: isWebBuild ? "/fish-reader/app/" : "/",

  build: {
    // web build goes to a separate folder so it never clobbers the desktop dist
    outDir: isWebBuild ? "dist-web" : "dist",
    emptyOutDir: true,
    // heavy parsers are already dynamically imported; keep them out of the
    // entry chunk so first paint on a phone isn't waiting on pdf.js
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("pdfjs-dist")) return "pdf";
          if (id.includes("jszip")) return "epub";
          if (id.includes("mammoth")) return "docx";
          return undefined;
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
