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
export default defineConfig(async () => ({
  plugins: [react()],

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
