import { availableParallelism } from "node:os";

import { defineConfig, devices } from "@playwright/test";

// `npm run e2e:serve` listens here: a port of its own, so it never collides with (or gets
// reused in place of) a `npm run dev` on 5173.
const BASE_URL = "http://localhost:5199";

const CI = !!process.env.CI;

export default defineConfig({
  testDir: ".",
  // `*.test.ts` is Vitest's; Playwright only ever picks up `*.spec.ts`.
  testMatch: ["e2e/**/*.spec.ts", "games/**/*.spec.ts"],
  // Every test signs in fresh players and opens its own matches, so tests share no state.
  fullyParallel: true,
  // Playwright's default of half the cores, capped at four. Every worker drives the same single
  // local server, and past four workers each test only gets slower until pages start timing out.
  workers: Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2))),
  // Twice Playwright's default. A move is only visible once it has gone from one browser through
  // the Vite dev server and the match's Durable Object to the other browser, and under parallel
  // load that round trip can take longer than 5s.
  expect: { timeout: 10_000 },
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  reporter: CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    // The app opens in the browser's language, and the specs read its English labels. Without
    // this, a machine set to Italian would run the whole suite in Italian.
    locale: "en-US",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The Vite dev server, so a game's UI can be edited while `npm run test:e2e:ui` is open.
    // `/api/health` only answers 200 once the D1 migrations have been applied.
    command: "npm run e2e:serve",
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
