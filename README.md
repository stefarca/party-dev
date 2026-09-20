# party-dev

A collection of small async, turn-based party games for playing with coworkers, hosted on
Cloudflare's free tier (Worker + Static Assets + Durable Objects + D1).

**What works today:** nickname-only identity (no passwords) where the nickname is unique and
_is_ the account — sign in with the same one on another device and your matches and record come
with you — a dashboard that buckets your matches into "your turn" / "waiting on others" /
"finished", five games (Battleship, Checkers, Connect 4, Tic-tac-toe and Trivia) playable over a
live WebSocket (with an HTTP fallback for every action) with a plain-language move history,
Slack nudges for players who are newly up and not currently connected, the whole UI in
English or Italian (picked from the browser's languages, switchable from the header), and an
installable PWA build so the app can live on a phone's home screen like any other game. See
[`games/README.md`](./games/README.md) for how to add another game.

## Prerequisites

- Node.js (v22+; developed against v26) and npm.
- No Cloudflare account is required for local development — everything below runs against the
  real `workerd` runtime locally via `@cloudflare/vite-plugin` and a local D1 SQLite file.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # sets a dummy SESSION_SECRET (and SLACK_WEBHOOK_URL) for local dev
npm run cf-typegen        # generates worker-configuration.d.ts (already committed; re-run if bindings change)
npm run db:migrate:local  # creates the local D1 sqlite file and applies migrations/000*.sql
npm run dev                # starts vite + workerd; prints the local URL
```

`SLACK_WEBHOOK_URL` is optional even locally: delete the line (or leave it blank) in `.dev.vars`
and nudges no-op cleanly (`worker/nudge.ts` logs once and returns) — nothing else in the app
depends on it.

Local D1 and Durable Object storage both persist under `.wrangler/state`, which
`wrangler d1 migrations apply --local` and `@cloudflare/vite-plugin` share by default. If you ever
see `/api/health` report "no such table: matches", the two are pointing at different persist
directories — re-run `npm run db:migrate:local` or pass matching `--persist-to` / `persistState`
options.

Other useful scripts:

- `npm run typecheck` — `tsc -b --noEmit` across the worker/client/node project references.
- `npm run lint` — runs ESLint over the repo.
- `npm run format` — formats the repo with Prettier.
- `npm run format:check` — checks Prettier formatting without writing changes.
- `npm test` — runs the Vitest suite under Node, including `MatchDO` tests (`worker/match.test.ts`)
  that run against a hand-built Durable Object stub backed by `node:sqlite`, not real `workerd`.
- `npm run test:e2e` — runs the Playwright suite in Chromium: every game played end to end by two
  browser contexts, plus the hub, lobby and transport flows. It starts its own server (see
  `e2e:serve` below), or reuses one already running. `npm run test:e2e:ui` opens Playwright's
  interactive runner instead. Install the browser once with `npx playwright install chromium`;
  on Linux, also install its system libraries with `sudo npx playwright install-deps chromium`.
- `npm run e2e:serve` — the server the Playwright suite runs against, on
  <http://localhost:5199>. It is `npm run dev` with its own D1/DO state in `.wrangler/e2e` (so it
  can run alongside `npm run dev`), and it reads only `SESSION_SECRET`, so it never sends Slack
  nudges. Open it in two browser profiles to play a match against yourself.
- `npm run build` — builds the client (`dist/client`) and the Worker bundle, including the
  service worker that makes the app installable.
- `npm run preview` — serves the production build locally. This is the only way to exercise the
  service worker: no dev server registers one. Note that the preview server reads its asset
  ETags once at startup, so rebuilding underneath it will not be picked up as an update — restart
  it to test the update prompt.

`.github/workflows/ci.yml` runs `lint`, `format:check`, `typecheck`, `test` and `build` on every
pull request, and the Playwright suite in a separate `e2e` job. When that job fails, its
`playwright-report` artifact holds the HTML report, with a trace of every retried test.

## Engine

Every game is a `GameModule` (`shared/game.ts`) run inside `MatchDO`. After every mutation — a
player joining, the host starting, a submitted action, or an alarm firing — `MatchDO.commit()`
runs the same pipeline, in this order:

1. persist the new state (+ `updatedAt`) to the DO's own SQLite,
2. append the mutation's events to the append-only event log,
3. recompute `waitingOn(state)` and `deadline(state)`,
4. reconcile the DO alarm against that deadline (`setAlarm`/`deleteAlarm`),
5. broadcast a per-player `snapshot` (each socket's own `view(state, playerId)`, never raw state)
   plus any new events to every connected WebSocket,
6. update the D1 index (`matches`/`match_players` — derived, dashboard-only),
7. nudge newly-waited-on players who are not connected, via a Slack incoming webhook
   (`worker/nudge.ts`), rate-limited to one nudge per player per match per turn plus a hard
   10-minute floor per player as a backstop. Several players becoming waited-on in the same commit
   (e.g. a trivia round start) produce one batched Slack message, never one per player.

Four rules every `GameModule` must follow:

- **Server-authoritative.** Clients send intents (`action`), never state; every inbound message is
  zod-validated (including via the module's own `actionSchema`).
- **`view()` is mandatory, not optional.** Broadcasting full state leaks hidden information — project
  per player and send tailored messages.
- **Seeded PRNG in state, never `Math.random()` inside `reduce`.** Use `shared/prng.ts` and store the
  advanced seed in the game's own state.
- **`onDeadline` must be idempotent.** Alarms are at-least-once with retries; key resolution on the
  round/phase number so re-running it on an already-resolved round is a no-op.

A new game is a folder under `games/` (its rules, its UI, and its UI's strings in `locales/`) plus
one line each in `games/registry.ts`'s `serverGames` (server rules) and `gameUi` (lazily-imported
client UI) — nothing else.

Two reference implementations of the phase types live under `games/`: Connect 4
(`games/connect4`, sequential turns) and Trivia (`games/trivia`, simultaneous answers + deadline,
with a reveal phase in between).

## Deploying (operator, requires a Cloudflare account)

This repo's `wrangler.jsonc` commits **placeholder** values for `d1_databases[0].database_id`
(`REPLACE_ME_SEE_README`) and `vars.PUBLIC_BASE_URL` (`http://localhost:5173`), since the real
values are operator-specific and shouldn't live in the repo. Deploys go through
[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml), which substitutes the real
values in at deploy time from a repo secret and a repo variable.

### One-time setup

1. `wrangler login`
2. `wrangler d1 create party` — copy the `database_id` from the output. (The deploy workflow
   applies `migrations/*.sql` on every run, so there's no separate manual migration step.)
3. `wrangler secret put SESSION_SECRET` — sets the HMAC key used to sign identity cookies.
   Generate a long random value; never reuse the `.dev.vars` dummy.
4. `wrangler secret put SLACK_WEBHOOK_URL` — optional. Sets the Slack incoming-webhook URL for
   turn nudges; if you skip this, `worker/nudge.ts` no-ops cleanly and the rest of the app is
   unaffected. Never commit a real value anywhere — it belongs only in this secret.
5. In the GitHub repo settings, add:
   - **Settings → Secrets and variables → Actions → Secrets:**
     - `CF_D1_DATABASE_ID` — the `database_id` from step 2.
     - `CLOUDFLARE_API_TOKEN` — an API token with Workers Scripts, Workers Routes, D1, and
       Durable Objects edit permissions for the target account.
     - `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID.
   - **Settings → Secrets and variables → Actions → Variables:**
     - `PUBLIC_BASE_URL` — the real public URL (e.g. `https://party-dev.<subdomain>.workers.dev`
       or a custom domain). Leaving this as the local-dev default in production means every Slack
       nudge links to localhost.

Never paste the real `database_id` or `PUBLIC_BASE_URL` into the committed `wrangler.jsonc` — the
workflow overwrites the placeholders in a checkout that only exists for the run, so the repo stays
generic.

### Deploying

Push to `main`, or run the **Deploy** workflow manually from the Actions tab
(`workflow_dispatch`). Locally, `npm run deploy` still works for ad hoc deploys if you paste the
real `database_id`/`PUBLIC_BASE_URL` into your own working copy first (don't commit them).
