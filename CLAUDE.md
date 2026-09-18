# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
cp .dev.vars.example .dev.vars   # dummy SESSION_SECRET + dummy SLACK_WEBHOOK_URL (see below)
npm run db:migrate:local         # creates the local D1 sqlite file under .wrangler/state
npm run dev                      # vite + real workerd, prints the local URL
```

Node 26 is pinned in `mise.toml` and CI. `SLACK_WEBHOOK_URL` is optional: with the copied dummy
value, nudges make a real request that fails and gets logged. Delete the line to make them a clean
no-op.

- `npm test` — vitest (node environment). Single file: `npx vitest run worker/match.test.ts`; single
  case: `npx vitest run games/trivia/game.test.ts -t "idempotent"`.
- `npm run typecheck` — `tsc -b --noEmit` across the three project references below.
- `npm run lint` / `npm run format` / `npm run format:check`.
- `npm run cf-typegen` — regenerates the committed `worker-configuration.d.ts`; re-run after
  changing bindings in `wrangler.jsonc`.
- CI (`.github/workflows/ci.yml`) runs lint, format:check, typecheck, test, build on every PR.

If `/api/health` reports "no such table: matches", the migration CLI and the vite plugin are
pointed at different `.wrangler/state` persist directories — re-run `npm run db:migrate:local`.

**Every push to `main` deploys to production** (`.github/workflows/deploy.yml`): it applies
`migrations/*.sql` to the remote D1 first, then runs `npm run deploy`. Migrations therefore hit
production before the new Worker is live. The workflow `sed`-substitutes the committed placeholders
`"database_id": "REPLACE_ME_SEE_README"` and `"PUBLIC_BASE_URL": "http://localhost:5173"` in
`wrangler.jsonc` by exact text. Keep those two lines byte-identical and never commit real values.
Because a migration runs while the old Worker is still serving, it must be additive and work with
that old Worker, like the existing `ADD COLUMN`s. One-time operator setup is in the README.

## Architecture

**One `MatchDO` class runs every game.** `worker/match.ts` holds no game-specific knowledge; it
looks games up through `games/registry.ts`. The Durable Object is authoritative; D1
(`migrations/*.sql`) is a derived, dashboard-only index that may be rebuilt or lag without
affecting correctness. Never read match truth from D1. The one other job D1 has is match-code
reservation. `POST /api/matches` inserts a placeholder `matches` row to claim a fresh code
(retrying on a primary-key collision) and deletes it if the DO create fails. Join checks that row
before it contacts the DO.

**Worker → DO boundary.** A match code is the DO name: `MATCH.idFromName(normalizeMatchCode(code))`
(`shared/ids.ts`). `worker/api.ts` and `worker/index.ts` verify the session and then forward to the
DO's internal routes (`/lobby/create`, `/lobby/join`, `/snapshot`, `/view`, `/start`, `/action`,
`/ws`). They pass the caller's `playerId` in the JSON body, or in `X-Player-Id`/`X-Player-Nickname`
headers for `/ws`. The DO trusts that id and only checks membership, so it must always come from
the verified session and never from a client payload.

**Everything funnels through `MatchDO.commit()`** — lobby create, join, start, action, and `alarm()`.
Its seven stages run in a binding order: persist → append events → recompute
`waitingOn`/`deadline` → reconcile the DO alarm → broadcast a per-player snapshot → sync the D1
index → Slack-nudge newly-waited-on disconnected players. Two rules hold inside it:

- Stages 1–2 are synchronous and protected by the DO input gate. Every stage after the first
  `await` must re-read `this.readMatch()` and recompute via `deriveWaitingAndDeadline()` before
  using either value — another request or an alarm can run to completion across any await.
- D1 writes go through `syncIndex()`, which queues onto `dbWriteQueue` and re-reads canonical
  state at its own turn, so the last writer to the queue always writes the latest truth.

`commit()` also auto-finalizes: any state whose `result()` is non-null flips `status` to `"done"`
and appends `match_finished`. Callers only assign `record.state` and call `commit()`.

**Game modules** implement `GameModule<S, A>` (`shared/game.ts`). The four binding rules — server
authority, mandatory per-player `view()`, seeded PRNG from `shared/prng.ts` threaded through state,
idempotent `onDeadline` — are enforced by convention and by each game's own tests, not by the
engine. `games/README.md` is the authoring checklist; `games/connect4` (sequential) and
`games/trivia` (simultaneous + deadline) are the two reference implementations.

What the engine _does_ handle, so a game need not: before `reduce` runs, `MatchDO.handleAction`
parses the action with `actionSchema` and rejects any player who is not in `waitingOn(state)`
(`not_your_turn`). To reject an illegal move, a game **throws from `reduce`**. The DO turns that
into an `invalid_move` error and skips `commit()`, so the persisted state is unchanged. `alarm()`
reschedules early fires. It also refuses to commit if `onDeadline` left `deadline()` unchanged,
which prevents an alarm loop.

Registering a game is one line in each of `serverGames` and `gameUi` in `games/registry.ts`.
`serverGames` is statically imported into the Worker bundle and **must never import a `.tsx` file**
— that would pull React into the Worker. `gameUi` is lazily imported so the client bundle does not
grow with every game.

**Two transports, one shape.** The WebSocket at `/ws/:id` and the HTTP routes
(`GET /api/matches/:id/snapshot`, `POST /api/matches/:id/actions`, `POST /api/matches/:id/start`)
both speak `MatchSnapshot` from `shared/protocol.ts`. WS is an optimization, never the only path —
anything reachable over the socket needs an HTTP equivalent. `web/useMatch.ts` fetches the HTTP
snapshot first, then attaches the socket as an add-on with backoff, and falls back to HTTP for
sends. Snapshots carry the event-log `seq`, and the client drops any snapshot older than the one
it is showing. Bump `PROTOCOL_VERSION` in `shared/version.ts` when a `shared/protocol.ts` message
shape changes incompatibly. The constant is not sent or checked at runtime, and
`shared/version.test.ts` pins its value, so bumping it means updating that test too.

**Durable Object constraints** (free tier): Hibernation API only
(`ctx.acceptWebSocket()` + `webSocketMessage()`, never `addEventListener`); per-connection identity
lives on `ws.serializeAttachment()`, never an in-memory map; no `setInterval` — use
`ctx.storage.setAlarm()`; keep reducers inside the 10 ms CPU budget. `alarm()` must never throw
(throws are retried up to 6 times and can double-resolve a round), and `webSocketMessage()` must
never throw (it kills the socket) — both convert failures into a logged error or a `{t:"error"}`
message. For WebSocket heartbeats, send a raw `"ping"` text frame. The runtime answers it with
`"pong"` through `setWebSocketAutoResponse` without waking the DO. The app-level `{t:"ping"}`
message exists only to answer non-conforming clients and must not be used for keepalives.

**Identity** is a nickname plus an HMAC-signed cookie (`worker/auth.ts`, Web Crypto, key in
`SESSION_SECRET`). No password, no session store. A missing secret fails closed with a 500 —
never fall back to an unsigned or constant key. Every inbound payload, REST bodies included, is
zod-validated with a schema from `shared/protocol.ts` or the game's own `actionSchema`.

`wrangler.jsonc`'s `run_worker_first` limits the Worker to `/api/*` and `/ws/*`; every other path,
including deep-linked SPA routes like `/m/ABCDEF`, is served by Static Assets with SPA fallback.

## Conventions

- Three TS project references: `tsconfig.worker.json` (worker + shared + games, no DOM),
  `tsconfig.client.json` (web + shared + games, DOM), `tsconfig.node.json` (build configs).
- `vitest.config.ts` includes only `**/*.test.ts` — a `.test.tsx` file would be silently skipped,
  so game UI is not unit-tested.
- There is no `@cloudflare/vitest-pool-workers` setup. `worker/match.test.ts` exercises `MatchDO`
  by mocking `cloudflare:workers` and hand-building the slice of `DurableObjectState`/`Env` it
  touches, backed by `node:sqlite` (typed by the local `worker/node-sqlite.d.ts`, since there is no
  `@types/node`). Engine tests run against `games/__fixtures__/counter.ts`, a test-only game that
  is deliberately left out of the registry; the test adds it to `serverGames` and removes it
  afterwards.
- Styling is Tailwind CSS v4 + HeroUI v3. `web/styles.css` is the only stylesheet in the repo —
  it imports `tailwindcss` before `@heroui/styles` (that order is mandatory: HeroUI's own rules
  must be able to override Tailwind's base layer), declares the `@source` globs, the design-token
  palette, and the HeroUI theme-variable bridge, and keeps only the handful of rules that
  genuinely cannot be Tailwind utilities. Game UI modules must not import a `.css` file of their
  own. Theme switching is `web/theme.ts` writing the `data-theme` attribute and a `dark` class on
  `<html>`, mirrored by the inline bootstrap script in `index.html` so the first paint never
  flashes the wrong theme. That script repeats the `"party-theme"` storage key as a literal, so
  keep it in sync with `THEME_STORAGE_KEY`. Tailwind emits only class names it can see in the
  source, so never build a class name from a runtime value like `` `bg-seat-${n}` ``. Use a static
  lookup of complete class strings, or set a CSS variable inline. `.mcp.json` configures the
  `heroui-react` MCP server for HeroUI v3 component docs.
- Client routing is hand-rolled in `web/router.tsx` with `useSyncExternalStore` and has no router
  dependency. Add new routes to its `parseRoute` table.
- Prettier: `printWidth` 100; `.claude/` and generated files are ignored. ESLint flat
  config enables only `rules-of-hooks` and `exhaustive-deps` from react-hooks — the
  React-Compiler-era rules flag deliberate patterns in `web/useMatch.ts`. `prettier` stays last in
  the config array.
- Work is driven by plan files in `.claude/plans/` (frontmatter `plan`/`goal`/`status`/
  `depends_on`; completed ones move to `archive/`). The directory is gitignored, so a plan's status
  and archive changes stay local. Commits are Conventional Commits, one per plan.
- Specs and plans are private. Never cite them in committed files: no spec filename, no `§`
  section numbers, no "plan 05" / "step 4" / "Risks/notes" references in code, comments, or docs.
  A comment should state the rule itself.
