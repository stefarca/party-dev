import { cloudflare } from "@cloudflare/vite-plugin";
import type { PluginConfig } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// `--mode e2e` is the Playwright web server (`npm run e2e:serve`). It keeps its D1 and Durable
// Object state in a directory of its own, so it never shares sqlite files with a `npm run dev`
// running alongside it. It also reads only SESSION_SECRET, from .dev.vars or else the
// environment, so a test run never posts nudges to whatever Slack webhook a developer has set.
const e2e: PluginConfig = {
  persistState: { path: ".wrangler/e2e" },
  config: { secrets: { required: ["SESSION_SECRET"] } },
};

// The service worker that makes the app installable. It is generated for the client build only —
// the plugin runs once per Vite environment, and the Worker environment emits none — and only by
// `vite build`: no dev server registers one, so `npm run dev`, `npm run e2e:serve` and the
// Playwright suite all behave exactly as they did before.
//
// The web app manifest is deliberately not generated here. It is a static `public/manifest.
// webmanifest` linked from index.html, so it is byte-identical in dev and in production and a
// test can assert against it without a production build.
//
// Two rules hold in this config:
//
//   - Nothing under /api or /ws is ever cached. Match truth lives in the Durable Object, so a
//     cached snapshot or event log is a wrong board. No runtime-caching rule matches them, which
//     means those requests never reach a Workbox route at all. The navigation denylist covers the
//     one case that would otherwise be intercepted: an /api URL typed into the address bar is a
//     navigation, and without the denylist the fallback would answer it with index.html.
//   - A new worker never activates on its own (`skipWaiting` is false). Reloading in the middle
//     of someone's turn is the app's call to make, so the waiting worker sits there until
//     web/components/UpdatePrompt.tsx asks for it.
//
// `public/push-sw.js` adds the push, notification-click and subscription-change handlers. It is
// `importScripts`ed rather than bundled, because Workbox generates this worker's source and
// there is nowhere to put app code inside it; that is also why it is plain JavaScript with no
// imports. It is left out of the precache (`globIgnores`) since the generated worker already
// pulls it in at install time.
const pwa = VitePWA({
  registerType: "prompt",
  manifest: false,
  // web/pwa.ts registers the worker itself, so that the update prompt has something to hook onto.
  injectRegister: null,
  workbox: {
    globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
    globIgnores: ["push-sw.js"],
    importScripts: ["push-sw.js"],
    // Deep-linked SPA routes like /m/ABCDEF are served by Static Assets' single-page-application
    // fallback online; this is the same fallback for an installed app that is offline.
    navigateFallback: "/index.html",
    navigateFallbackDenylist: [/^\/api\//, /^\/ws\//],
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    skipWaiting: false,
    runtimeCaching: [
      // The display and text faces come from Google Fonts. A blocked request already costs
      // nothing but a different first paint (index.html says so, and styles.css has the fallback
      // chain), but caching them keeps an installed app looking like itself when it opens cold
      // on a bad connection.
      {
        urlPattern: ({ url }) => url.origin === "https://fonts.googleapis.com",
        handler: "StaleWhileRevalidate",
        options: { cacheName: "google-fonts-stylesheets" },
      },
      {
        urlPattern: ({ url }) => url.origin === "https://fonts.gstatic.com",
        handler: "CacheFirst",
        options: {
          cacheName: "google-fonts-files",
          expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
          // Font files come back opaque (status 0) from a cross-origin request without CORS.
          cacheableResponse: { statuses: [0, 200] },
        },
      },
    ],
  },
});

export default defineConfig(({ mode }) => ({
  plugins: [tailwindcss(), react(), cloudflare(mode === "e2e" ? e2e : {}), pwa],
}));
