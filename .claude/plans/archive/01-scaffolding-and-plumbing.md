---
plan: 01-scaffolding-and-plumbing
goal: Implement PLAN.md — async turn-based party games on Cloudflare (Worker + Static Assets + Hono + Durable Objects with SQLite + D1 index + Slack nudges)
status: done
depends_on: []
---

# Project scaffolding + Worker/DO/D1 plumbing proof

## Assumptions

These apply to the whole plan series (01–08). They were chosen by the planner where
`/home/stefano/workspace/party-dev/PLAN.md` was silent; do not re-litigate them in later plans.

1. **No Cloudflare credentials are available to the implementer.** PLAN.md §12 step 1 says
   "deployed", but `wrangler d1 create`, `wrangler secret put` and `wrangler deploy` all require an
   authenticated account. Therefore: every plan's verification is **local** (`workerd` via
   `@cloudflare/vite-plugin`, local D1). The real deploy is written up as an operator checklist in
   `README.md` and is executed by the repo owner, not by an implementer.
   `d1_databases[0].database_id` is committed as a placeholder string.
2. **Vitest (node environment) is the test runner**, used only for pure modules (game reducers,
   PRNG, protocol schemas, match-code generation). `@cloudflare/vitest-pool-workers` /
   DO-integration tests are **out of scope for all 8 plans**; DO behaviour is verified by the manual
   curl/browser steps each plan spells out.
3. **No ESLint / Prettier.** The quality gate is `npm run typecheck` + `npm run build` + `npm test`.
4. **`matchId === match code`** (a 6-character human-typable code). The DO is addressed with
   `env.MATCH.idFromName(matchId)`. There is no separate opaque id.
5. **Single-player / offline games (PLAN.md §3) are out of scope** for this series.
6. `partyserver` (§1 "Optional") is **not** used; room routing is ~15 lines of Hono.

## Objective

Create the entire project skeleton — `package.json`, TypeScript configs, `wrangler.jsonc`, Vite +
React client, Hono Worker, an empty `MatchDO` with SQLite storage, and the D1 schema from PLAN.md §6
— and prove the plumbing end to end locally: a browser request hits the SPA, an `/api/health` call
goes Worker → DO → back, and a second `/api/health` field proves the D1 binding answers a query.

Out of scope: identity/cookies, match create/join, the dashboard, WebSockets, the event log, the
game engine, any game, Slack. `MatchDO` in this plan does nothing but answer a ping and create its
tables.

## Context

- The repo contains only `PLAN.md` and `README.md`. Branch `bootstrap-party-engine` off `main`.
- Toolchain present: Node v26.8.2, npm 11.19.1, `npx wrangler` 4.131.x.
- **PLAN.md §9 is the binding repo layout.** Use exactly these paths: `wrangler.jsonc`,
  `shared/protocol.ts`, `worker/index.ts` (Hono), `worker/match.ts` (`MatchDO`), `games/`, `web/`.
- **PLAN.md §10 gotchas that bite in this plan:** migrations must use `new_sqlite_classes` (not
  `new_classes`) or the free plan rejects the deploy; never `setInterval`.
- Current published versions (verified 2026-09-11) — use caret ranges on these:
  `hono` 4.13.x, `zod` 4.6.x, `vite` 8.3.x, `react`/`react-dom` 19.3.x,
  `@cloudflare/vite-plugin` 1.54.x, `wrangler` 4.131.x, `vitest` 5.0.x, `typescript` 5.9+.
- **Deviation from PLAN.md §9's `wrangler.jsonc` sample:** `assets.directory` must be **omitted**.
  `@cloudflare/vite-plugin` populates it automatically with the client build output path
  (`dist/client`) when it generates `dist/party-dev/wrangler.json`. Keep
  `assets.not_found_handling: "single-page-application"`. Note this deviation in a `// ` comment in
  `wrangler.jsonc`.

## Steps

1. Create `package.json`: `"name": "party-dev"`, `"private": true`, `"type": "module"`.
   Dependencies: `hono`, `zod`, `react`, `react-dom`.
   Dev dependencies: `vite`, `@vitejs/plugin-react`, `@cloudflare/vite-plugin`, `wrangler`,
   `typescript`, `vitest`, `@types/react`, `@types/react-dom`.
   Scripts:
   - `dev`: `vite`
   - `build`: `vite build`
   - `preview`: `vite preview`
   - `deploy`: `npm run build && wrangler deploy`
   - `typecheck`: `tsc -b --noEmit` (see step 3 for the project layout that makes this work)
   - `test`: `vitest run`
   - `cf-typegen`: `wrangler types`
   - `db:migrate:local`: `wrangler d1 migrations apply party --local`
   - `db:migrate:remote`: `wrangler d1 migrations apply party --remote`
2. Create `wrangler.jsonc` per PLAN.md §9 with the deviation above:
   `name: "party-dev"`, `compatibility_date: "2026-09-01"`, `main: "worker/index.ts"`,
   `assets: { not_found_handling: "single-page-application" }`,
   `durable_objects.bindings: [{ name: "MATCH", class_name: "MatchDO" }]`,
   `migrations: [{ tag: "v1", new_sqlite_classes: ["MatchDO"] }]`,
   `d1_databases: [{ binding: "DB", database_name: "party", database_id: "REPLACE_ME_SEE_README" }]`,
   `observability: { enabled: true }`.
3. TypeScript config. The Worker and the client have incompatible lib/types, and `shared/` +
   `games/` are imported by both, so use a solution-style setup:
   - `tsconfig.json` — references only, no files.
   - `tsconfig.worker.json` — includes `worker/**`, `shared/**`, `games/**`,
     `worker-configuration.d.ts`; `module`/`moduleResolution` `bundler`, `target` `es2022`,
     `strict: true`, `noEmit: true`, no DOM lib.
   - `tsconfig.client.json` — includes `web/**`, `shared/**`, `games/**`; `lib` includes `DOM`,
     `jsx: "react-jsx"`, `strict`, `noEmit`.
   - `tsconfig.node.json` — includes `vite.config.ts`, `vitest.config.ts` if separate.
   Verify `npm run typecheck` passes with this arrangement before moving on; adjust
   `composite`/`noEmit` flags as `tsc -b` requires.
4. Run `npx wrangler types` to generate `worker-configuration.d.ts` (gives the `Env` interface with
   `MATCH` and `DB`). **Commit this file** so `typecheck` works without wrangler auth. Re-run
   `cf-typegen` whenever bindings change.
5. Create `vite.config.ts`: `plugins: [react(), cloudflare()]`. No other options unless the build
   fails without them.
6. Client scaffold, rooted at the repo root so `@cloudflare/vite-plugin` finds `wrangler.jsonc`:
   - `index.html` at the repo root, loading `/web/main.tsx`.
   - `web/main.tsx` — React 19 `createRoot` render of `<App />`.
   - `web/App.tsx` — a placeholder shell that fetches `/api/health` on mount and renders the JSON.
     This is throwaway UI; plan 03 replaces it.
   - `web/styles.css` — minimal reset + a readable default (system font stack, max-width container,
     dark-on-light). Keep it small; no CSS framework, no Tailwind.
7. `worker/index.ts`: create the Hono app typed as `Hono<{ Bindings: Env }>`, mount an
   `/api` sub-router, and export `default { fetch: app.fetch }`. Re-export `MatchDO` from
   `worker/match.ts` (the DO class must be exported from the Worker entry module).
   Unmatched requests must fall through to static assets — with Static Assets configured, requests
   that don't match a Worker route are served by the asset handler automatically; do **not**
   hand-roll an asset fallback. Return 404 JSON for unknown `/api/*` paths.
8. `worker/match.ts`: `export class MatchDO extends DurableObject<Env>`.
   - In the constructor, call `this.ctx.storage.sql.exec` with `CREATE TABLE IF NOT EXISTS meta (key
     TEXT PRIMARY KEY, value TEXT)`. (Later plans add `events` and the match record; this table is
     the DO's whole schema for now.)
   - Implement `async fetch(request)` handling exactly one internal route `GET /ping`, returning
     JSON `{ ok: true, id: <the DO name or id string>, tables: <count of rows in sqlite_master> }`.
     Everything else → 404.
   - Add a short comment block citing PLAN.md §10: hibernation API only (no `addEventListener`),
     no `setInterval`, persist on mutation.
9. `migrations/0001_init.sql`: the three statements from PLAN.md §6 verbatim (`matches`,
   `match_players`, `idx_waiting`), each guarded with `IF NOT EXISTS`.
10. `/api/health` in `worker/index.ts`: forward to the DO named `health` via
    `env.MATCH.idFromName("health")` + a `GET http://do/ping` fetch, and run
    `env.DB.prepare("SELECT count(*) AS n FROM matches").first()` against D1. Respond
    `{ ok, now, do: <DO ping body>, d1: { matches: n } }`. If either subsystem throws, return 500
    with the failing subsystem named — this endpoint is the plumbing proof and must not silently
    degrade.
11. `.gitignore`: `node_modules/`, `dist/`, `.wrangler/`, `.dev.vars`, `*.local`.
    Do **not** ignore `worker-configuration.d.ts`.
12. `vitest.config.ts` (or a `test` block in `vite.config.ts` if cleaner): node environment,
    include `**/*.test.ts`. Add one real test — `shared/protocol.test.ts` is premature, so instead
    add `worker/health.test.ts`-style coverage only if a pure function exists; if there is genuinely
    nothing pure to test yet, create `shared/version.ts` exporting `PROTOCOL_VERSION = 1` and test
    that `npm test` runs green with one trivial assertion. Keep it to one file.
13. Rewrite `README.md`: what the project is (link PLAN.md), prerequisites, `npm install`,
    `npm run db:migrate:local`, `npm run dev`, and a **"Deploying (operator, requires a Cloudflare
    account)"** section: `wrangler login` → `wrangler d1 create party` → paste the returned
    `database_id` into `wrangler.jsonc` → `npm run db:migrate:remote` → `npm run deploy`. State
    explicitly that `database_id` is a placeholder in git.

## Acceptance criteria

- [ ] `npm install` succeeds from a clean checkout.
- [ ] `npm run typecheck`, `npm run build`, and `npm test` all pass.
- [ ] `wrangler.jsonc` uses `new_sqlite_classes` (**not** `new_classes`) and omits `assets.directory`.
- [ ] Repo layout matches PLAN.md §9: `wrangler.jsonc`, `worker/index.ts`, `worker/match.ts`,
      `shared/`, `games/` (may be empty or absent until plan 02), `web/`.
- [ ] `npm run build` produces `dist/client/index.html` plus a built Worker and a generated
      `dist/party-dev/wrangler.json` whose `assets.directory` points at the client output.
- [ ] `MatchDO` creates its `meta` table in the constructor and answers `GET /ping`.
- [ ] `/api/health` returns 200 with both a `do` and a `d1` field populated; killing either binding
      yields a 500 that names the failing subsystem.
- [ ] `README.md` documents the manual deploy checklist and that `database_id` is a placeholder.
- [ ] No secrets, no `.dev.vars`, no `dist/`, no `.wrangler/` committed.

## Verification

```bash
cd /home/stefano/workspace/party-dev
npm install
npm run cf-typegen
npm run typecheck
npm test
npm run build
npm run db:migrate:local          # creates the local D1 sqlite and applies 0001_init.sql
npm run dev                       # workerd + vite, note the printed localhost port
# in a second shell:
curl -s localhost:5173/api/health | head -c 400      # => {"ok":true,...,"do":{...},"d1":{"matches":0}}
curl -s localhost:5173/ | head -c 200                 # => the SPA index.html
curl -s -o /dev/null -w '%{http_code}\n' localhost:5173/some/deep/spa/route   # => 200 (SPA fallback)
```

Passing looks like: `/api/health` 200 with both subsystems reporting, the SPA loading in a browser
and rendering the health JSON, and all three npm gates green.

## Risks / notes

- **Local D1 state path:** `wrangler d1 migrations apply --local` and `@cloudflare/vite-plugin` must
  share the same persist directory (`.wrangler/state`) or `/api/health` will report "no such table:
  matches". If they diverge, set the plugin's `persistState` option (or wrangler's
  `--persist-to`) so both point at `.wrangler/state`, and document the chosen path in `README.md`.
- The Vite dev server proxies Worker requests through `workerd`; if `/api/health` 404s in dev but
  works in `npm run preview`, the Hono route is being shadowed by the asset handler — check route
  ordering, not the plugin.
- Keep `MatchDO` genuinely empty. Anticipating plans 02/04 here (players, state, alarms) makes the
  next two plans unreviewable.
- 10 ms CPU per invocation on the free plan (§2): no heavy work in the health path.
