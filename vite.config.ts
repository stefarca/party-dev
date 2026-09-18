import { cloudflare } from "@cloudflare/vite-plugin";
import type { PluginConfig } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `--mode e2e` is the Playwright web server (`npm run e2e:serve`). It keeps its D1 and Durable
// Object state in a directory of its own, so it never shares sqlite files with a `npm run dev`
// running alongside it. It also reads only SESSION_SECRET, from .dev.vars or else the
// environment, so a test run never posts nudges to whatever Slack webhook a developer has set.
const e2e: PluginConfig = {
  persistState: { path: ".wrangler/e2e" },
  config: { secrets: { required: ["SESSION_SECRET"] } },
};

export default defineConfig(({ mode }) => ({
  plugins: [tailwindcss(), react(), cloudflare(mode === "e2e" ? e2e : {})],
}));
