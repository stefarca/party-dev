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
- `npm run test:e2e` — Playwright, Chromium only. It starts `npm run e2e:serve` on port 5199, or
  reuses one already running there. Single file: `npx playwright test games/connect4`; single case:
  `npx playwright test -g "four in a column"`; `npm run test:e2e:ui` for the interactive runner,
  which picks up UI edits through the dev server's HMR. One-time setup is
  `npx playwright install chromium`, plus `sudo npx playwright install-deps chromium` on Linux.
- `npm run e2e:serve` — the Vite dev server in `--mode e2e`. Its D1 and DO state live in
  `.wrangler/e2e`, so it can run beside `npm run dev`. It reads only `SESSION_SECRET` (from
  `.dev.vars`, or from the environment when there is none), so a test run never sends a Slack
  nudge. Open it in two browser profiles to play a match against yourself.
- `npm run typecheck` — `tsc -b --noEmit` across the four project references below.
- `npm run lint` / `npm run format` / `npm run format:check`.
- `npm run cf-typegen` — regenerates the committed `worker-configuration.d.ts`; re-run after
  changing bindings in `wrangler.jsonc`.
- CI (`.github/workflows/ci.yml`) runs lint, format:check, typecheck, test, build on every PR,
  plus a separate `e2e` job that runs the Playwright suite and uploads its HTML report.

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
looks games up through `games/registry.ts`. The Durable Object is authoritative; D1's `matches` and
`match_players` (`migrations/*.sql`) are a derived, dashboard-only index that may be rebuilt or lag
without affecting correctness. Never read match truth from D1. D1 has two other jobs. One is
match-code reservation: `POST /api/matches` inserts a placeholder `matches` row to claim a fresh
code (retrying on a primary-key collision) and deletes it if the DO create fails, and join checks
that row before it contacts the DO. The other is the player registry.

**`players` is the one authoritative table in D1.** A nickname is the account — the same one on a
second device is the same player, with the same matches and record — so `players` and its unique
index on `nickname_key` (`shared/nickname.ts` folds case, whitespace and NFKC) cannot be rebuilt
from anything. `worker/players.ts` owns every read and write of it. The unique index, not any check
in that file, is what makes a claim atomic, so each write there is written to lose that race
gracefully. There is no password: whoever claims a nickname first owns it, and whoever types it
afterwards is signed in as them. The hub's record (`played`/`finished`/`won`) is read from the
derived index — `match_players.won` is written by `writeIndexNow()` from `result()` — and follows
the player id, so a rename keeps it. A reset sets `players.stats_since`, and the record then counts
only matches created from that moment on. Nothing is deleted.

**Public lobbies.** A match's `visibility` (`private` by default, or `public`) lives on the DO
record. The host picks it at creation and may change it through `/lobby/visibility` until the match
starts. Anyone with the code can join either kind. A public one is also listed under the hub's
Public tab, which `worker/hub.ts` reads from `matches.visibility` in the derived index. Only lobbies
the caller is not in and that still have a seat are listed. The seat check runs in SQL, before the
LIMIT, against seat counts taken from the game catalog. An index row whose `visibility` is NULL
predates the column and counts as private. A listing lasts a day, and every join starts that day
over: the record's `publicUntil` is the DO alarm while the match is a lobby, and `alarm()` turns a
lobby private once it passes. Expiry only unlists: the lobby, its players and its code stay.

**`players` is the only place a nickname is stored.** Match records, the event log and
`match_players` hold player ids. Every roster is named from `players` when it is read: the hub
JOINs it, and `MatchDO.readNamedMatch()` looks up names before any snapshot or summary leaves the
DO. So a rename reaches every match at once. A name the lookup cannot find shows as
`UNKNOWN_NICKNAME` (`shared/nickname.ts`) and is never stored.

**Worker → DO boundary.** A match code is the DO name: `MATCH.idFromName(normalizeMatchCode(code))`
(`shared/ids.ts`). `worker/api.ts` and `worker/index.ts` verify the session and then forward to the
DO's internal routes (`/lobby/create`, `/lobby/join`, `/lobby/visibility`, `/snapshot`, `/view`,
`/events`, `/start`, `/action`, `/ws`). They pass the caller's `playerId` in the JSON body, or in an `X-Player-Id` header for `/ws`. The DO trusts that id and only checks membership, so it must always come from
the verified session and never from a client payload.

**Everything funnels through `MatchDO.commit()`** — lobby create, join, visibility, start, action,
and `alarm()`.
Its seven stages run in a binding order: persist → append events → recompute
`waitingOn`/`deadline` → reconcile the DO alarm → broadcast a per-player snapshot → sync the D1
index → Slack-nudge newly-waited-on disconnected players. Two rules hold inside it:

- Stages 1–2 are synchronous and protected by the DO input gate. Every stage after the first
  `await` must re-read `this.readMatch()` and recompute via `deriveWaitingAndDeadline()` before
  using either value — another request or an alarm can run to completion across any await. The
  broadcast's name lookup is one of those awaits, so stage 5 builds its snapshots from the record
  `readNamedMatch()` returns, which is re-read after the lookup.
- D1 writes go through `syncIndex()`, which queues onto `dbWriteQueue` and re-reads canonical
  state at its own turn, so the last writer to the queue always writes the latest truth.

`commit()` also auto-finalizes: any state whose `result()` is non-null flips `status` to `"done"`
and appends `match_finished`. Callers only assign `record.state` and call `commit()`.

**Game modules** implement `GameModule<S, A>` (`shared/game.ts`). The four binding rules — server
authority, mandatory per-player `view()`, seeded PRNG from `shared/prng.ts` threaded through state,
idempotent `onDeadline` — are enforced by convention and by each game's own tests, not by the
engine. `games/README.md` is the authoring checklist; `games/connect4` (sequential) and
`games/trivia` (simultaneous + deadline) are the two reference implementations.

Optional `describeAction(state, action, by)` returns `{ key, values }` naming a string in the game's
own i18n namespace, and is what the history panel renders (`state` is the one the action was played
against). A game that has one keeps its raw actions out of the event log entirely — the description
is stored and broadcast instead, and a throwing `describeAction` falls back to the raw action rather
than failing the move. That is a correctness rule, not a cosmetic one: events go to every connected
player the instant they are appended, so a raw action would leak what `view()` hides (a trivia
answer before its reveal). The event payload union, `MatchEventPayload` in `shared/protocol.ts`, is
closed; a new event type needs wording in `web/components/HistoryPanel.tsx` and `web/locales/`.

What the engine _does_ handle, so a game need not: before `reduce` runs, `MatchDO.handleAction`
parses the action with `actionSchema` and rejects any player who is not in `waitingOn(state)`
(`not_your_turn`). To reject an illegal move, a game **throws from `reduce`**. The DO turns that
into an `invalid_move` error and skips `commit()`, so the persisted state is unchanged. `alarm()`
reschedules early fires. It also refuses to commit if `onDeadline` left `deadline()` unchanged,
which prevents an alarm loop.

Registering a game is one line in each of `serverGames` and `gameUi` in `games/registry.ts`.
`serverGames` is statically imported into the Worker bundle and **must never import a `.tsx` file**
— that would pull React into the Worker. `gameUi` is lazily imported so the client bundle does not
grow with every game. A game's tile icon is optional and lives in a third, client-only map,
`gameIcons` in `games/icons.ts`, kept out of the registry for the same reason; a game without one
falls back to a hash-picked motif.

**Two transports, one shape.** The WebSocket at `/ws/:id` and the HTTP routes
(`GET /api/matches/:id/snapshot`, `GET /api/matches/:id/events`, `POST /api/matches/:id/actions`,
`POST /api/matches/:id/start`) speak `MatchSnapshot`/`MatchEvent` from `shared/protocol.ts`. WS is
an optimization, never the only path — anything reachable over the socket needs an HTTP equivalent.
`web/useMatch.ts` fetches the HTTP snapshot first, _then_ the event log, then attaches the socket as
an add-on with backoff, and falls back to HTTP for sends. That order is load-bearing: applying a
snapshot moves `since` to the latest seq, so without the events fetch a reloaded page would ask the
socket only for events newer than ones it never had, and show an empty history until the next move.
`HISTORY_LIMIT` bounds both the server's reply and the client's buffer. Snapshots carry the
event-log `seq`, and the client drops any snapshot older than the one it is showing. Bump `PROTOCOL_VERSION` in `shared/version.ts` when a `shared/protocol.ts` message
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
`POST /api/identity` does two different things. With no session it signs in, adopting whoever
holds that nickname (which is what makes a second device work). With a session it renames that
player, keeping their id and refusing (`409 nickname_taken`) a nickname someone else holds.
`POST /api/identity/signout` is the only way to switch players on a device that already has a
session. `GET /api/me` re-reads the registry instead of trusting the cookie's copy of the nickname,
so a rename made elsewhere reaches this device. A cookie whose player has no registry row (a
pre-registry session that never played, or one minted by the old Worker during a deploy) is
registered under its own nickname if that is free, and dropped if it is not.

`wrangler.jsonc`'s `run_worker_first` limits the Worker to `/api/*` and `/ws/*`; every other path,
including deep-linked SPA routes like `/m/ABCDEF`, is served by Static Assets with SPA fallback.

**The app is installable.** `vite build` generates a Workbox service worker (`vite-plugin-pwa`)
into the client output, and only `vite build` does: no dev server registers one, so `npm run dev`,
`npm run e2e:serve` and the Playwright suite behave as if none of this existed. Use
`npm run build && npm run preview` to exercise it. Two rules hold in `vite.config.ts`. Nothing
under `/api` or `/ws` is ever cached — match truth is the DO's, so a cached snapshot is a wrong
board; no runtime-caching rule matches them, and the navigation fallback carries a denylist so an
`/api` URL typed into the address bar is not answered with `index.html`. And a new worker never
activates on its own: `web/components/UpdatePrompt.tsx` registers the worker and offers the
waiting build, because applying one means a reload, and an unasked-for reload lands mid-move. A
player therefore keeps running the build they loaded until they accept that prompt, which matters
because every push to `main` deploys.

The web app manifest is _not_ generated: `public/manifest.webmanifest` is a static file linked
from `index.html`, so it is byte-identical in dev and in production and `e2e/pwa.spec.ts` can
assert it without a production build. It is English-only — a browser reads it once, at install
time, and nothing in it is reachable through `useLanguage()`. Its `theme_color`/`background_color`
and the two `theme-color` metas repeat the dark and light `--surface-void` from `web/styles.css`
as literals, the same duplication the theme bootstrap makes with its storage key; that spec fails
when they drift. The icons are in `public/`: `icon-192.png` and `icon-512.png` are rendered from
`favicon.svg`, and `icon-maskable-512.png` and `apple-touch-icon.png` from `icon.svg`, the
full-bleed variant whose tiles sit inside the maskable safe zone.

## Conventions

- Four TS project references: `tsconfig.worker.json` (worker + shared + games, no DOM),
  `tsconfig.client.json` (web + shared + games, DOM), `tsconfig.node.json` (build configs), and
  `tsconfig.e2e.json` (`playwright.config.ts`, `e2e/`, `games/**/*.spec.ts`; Node + DOM). The
  worker and client projects exclude `games/**/*.spec.ts` and load no `@types` packages, so
  `@types/node` (installed for Playwright) never reaches Worker or browser code.
- `*.test.ts` is Vitest and `*.spec.ts` is Playwright; neither runner picks up the other's.
  `vitest.config.ts` includes only `**/*.test.ts` — a `.test.tsx` file would be silently skipped,
  so game UI is not unit-tested. The Playwright specs cover it instead.
- There is no `@cloudflare/vitest-pool-workers` setup. `worker/match.test.ts` and
  `worker/history.test.ts` exercise `MatchDO` by mocking `cloudflare:workers` and hand-building the
  slice of `DurableObjectState`/`Env` it touches, backed by `node:sqlite` (typed by the local
  `worker/node-builtins.d.ts`, since the worker project loads no `@types` packages). Engine tests
  run against `games/__fixtures__/counter.ts`, a test-only game that is deliberately left out of the
  registry; the test adds it to `serverGames` and removes it afterwards. `worker/players.test.ts`
  and `worker/hub.test.ts` run their SQL against the real schema through
  `worker/__fixtures__/d1.ts`, a D1 mock on `node:sqlite` that applies every `migrations/*.sql` in
  name order. A new migration needs no change there.
- Playwright specs drive the real app (Vite + workerd) through the UI and never import app code.
  `e2e/fixtures.ts` is the harness. `newPlayer(name)` gives each player a browser context of
  their own, signed in over the API as `uniqueNickname(name)` — a nickname is an account and the e2e
  database outlives a run, so two specs sharing a literal would share a player. Assert against
  `player.nickname`, never the base name, and use `uniqueNickname()` for any nickname a spec types
  into the gate itself. `startMatch(gameId)` creates, joins and starts a match over
  HTTP, then opens it for every player and waits until each socket is live; its `players[0]` is
  whoever the game waits on first. Each game has `games/<id>/ui.spec.ts`; flows shared by every
  game (identity, hub, lobby, transports) are in `e2e/*.spec.ts`. Locate elements by role and
  accessible name, the same labels the games already give screen readers. Sequential games'
  starting player is random, so specs take roles from `players` order rather than nicknames.
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
- UI strings go through i18next + react-i18next, set up in `web/i18n.ts`. English is the source
  and fallback; Italian ships too. `web/locales/<lng>.json` is the `common` namespace, and
  `games/<id>/locales/<lng>.json` is namespace `<id>`, which includes the game's display `name`.
  `web/translations.ts` globs both eagerly, so adding a language or a game's strings means adding
  files and nothing else; the pickable languages are those with a `web/locales/<lng>.json`. Keys
  are type-checked against the English files: `web/i18n.ts` declares `common`, and each game's
  `ui.tsx` declares its own namespace on i18next's `ResourceNamespaceMap`. A game UI must use only
  its own namespace: the worker project type-checks it without `web/`, so `common` does not exist
  there. `web/translations.test.ts` fails when a language lacks a key or changes a
  `{{variable}}`, and when a game's English `name` differs from its `meta.name`. Dates, times and
  durations go through `Intl` with `useLanguage()`, never through a translated string. Server
  error messages are English, for logs. The client shows `errors.<code>` through `errorText()` in
  `web/errors.ts` instead. Playwright pins `locale: "en-US"` because specs match English labels.
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
