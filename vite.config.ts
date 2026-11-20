import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Served from https://<user>.github.io/sundialed-finance/ on GitHub Pages. Override with VITE_BASE (e.g. "/").
const base = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.VITE_BASE ?? "/sundialed-finance/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Our own service worker (src/sw.js) so it can receive push notifications.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      includeAssets: ["apple-touch-icon.png"],
      manifest: {
        name: "Sundialed",
        short_name: "Sundialed",
        description: "Household budget",
        start_url: base,
        scope: base,
        display: "standalone",
        background_color: "#f2f2f7",
        theme_color: "#f2f2f7",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      // Only the app's own files are cached. API traffic is never cached: budget data should
      // not sit in a service-worker cache.
      injectManifest: { globPatterns: ["**/*.{js,css,html,png,svg,ico,webmanifest}"] },
    }),
  ],
  test: { include: ["supabase/functions/**/*.test.ts", "src/**/*.test.ts"] },
});
