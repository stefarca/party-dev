# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
cp .dev.vars.example .dev.vars   # dummy SESSION_SECRET, SLACK_WEBHOOK_URL and VAPID keys (see below)
npm run db:migrate:local         # creates the local D1 sqlite file under .wrangler/state
npm run dev                      # vite + real workerd, prints the local URL
```

Node 26 is pinned in `mise.toml` and CI. `SLACK_WEBHOOK_URL` is optional: with the copied dummy
value, nudges make a real request that fails and gets logged. Delete the line to make them a clean
no-op. `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` are optional the same way, and only
as a set — missing any one of them and `worker/push.ts` sends nothing and `GET /api/push/key`
answers `null`, which is what makes the client hide the notification control. The pair in
`.dev.vars.example` is a real throwaway, published deliberately so local dev runs the real path.

- `npm test` — vitest (node environment). Single file: `npx vitest run worker/match.test.ts`; single
  case: `npx vitest run games/trivia/game.test.ts -t "idempotent"`.
- `npm run test:coverage` — the same run with V8 coverage into `coverage/`. It counts only
  `worker/`, `shared/` and game logic: game UIs and `web/` are Playwright's, and Playwright's
  Worker runs in workerd, where coverage is not collected.
- `npm run test:e2e` — Playwright, Chromium only. It starts `npm run e2e:serve` on port 5199, or
  reuses one already running there. Single file: `npx playwright test games/connect4`; single case:
  `npx playwright test -g "four in a column"`; `npm run test:e2e:ui` for the interactive runner,
  which picks up UI edits through the dev server's HMR. One-time setup is
  `npx playwright install chromium`, plus `sudo npx playwright install-deps chromium` on Linux.
- `npm run e2e:serve` — the Vite dev server in `--mode e2e`. Its D1 and DO state live in
  `.wrangler/e2e`, so it can run beside `npm run dev`. It reads only `SESSION_SECRET` (from
  `.dev.vars`, or from the environment when there is none) — the vite plugin loads only the
  secrets a mode declares — so a test run never sends a Slack nudge and never has VAPID keys. Open it in two browser profiles to play a match against yourself.
- `npm run typecheck` — `tsc -b --noEmit` across the four project references below.
- `npm run lint` / `npm run format` / `npm run format:check`.
- `npm run cf-typegen` — regenerates the committed `worker-configuration.d.ts`; re-run after
  changing bindings in `wrangler.jsonc`. It reads secrets from `.dev.vars.example`, not your own
  `.dev.vars`, so the file comes out the same on every machine.
- CI (`.github/workflows/ci.yml`) runs lint, format:check, typecheck, test (with coverage), build on every PR,
  plus a separate `e2e` job that runs the Playwright suite and uploads its HTML report. The
  coverage lands as a PR comment on the changed files; it has no threshold and never fails a job.

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

**One `MatchDO` class runs every multiplayer game.** `worker/match.ts` holds no game-specific
knowledge; it looks games up through `games/registry.ts`. The daily single-player games are run by
`DailyDO` instead (see below). The Durable Object is authoritative; D1's `matches`,
`match_players` and `turn_waits` (`migrations/*.sql`) are a derived index, read by the hub, the
stats page and the weekly recap, that may be rebuilt or lag without affecting correctness. Never
read match truth from D1. D1 has four other jobs. One is
match-code reservation: `POST /api/matches` inserts a placeholder `matches` row to claim a fresh
code (retrying on a primary-key collision) and deletes it if the DO create fails, and join checks
that row before it contacts the DO. The second is the player registry. The third is
`push_subscriptions`, the devices to notify, which is authoritative for the same reason `players`
is: a subscription is a capability a browser granted once and nothing can rebuild it. The fourth is
`recaps`, the weeks whose Slack recap has already gone out (see below).

**`players` is authoritative, not derived.** A nickname is the account — the same one on a
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
predates the column and counts as private.

**Lobbies expire.** A lobby nobody starts is deleted at the record's `expiresAt`, whatever its
visibility and however many players it has. That is a day after its creation, and going from
private to public sets it to a day from then. Nothing else moves it: joins do not, and going back
to private keeps it. While the match is a lobby, the DO alarm is `lobbyWakeAt()`: first an hour
before `expiresAt`, when the host gets a nudge of kind `lobbyExpiring` whether or not they are
watching (`expiryWarnedFor` records it went out for that `expiresAt`), then `expiresAt` itself.
`dissolveLobby()` empties the DO's tables rather than calling `deleteAll()`, which would drop
them from under an instance whose constructor will not run again. It closes the sockets with a
`not_found` error and deletes the D1 rows, which frees the code and takes the lobby off every hub.
A record from before `expiresAt` existed falls back to its old `publicUntil`, then to a day after
creation. A lobby nobody touches never wakes to set an alarm, so an hourly cron
(`triggers.crons` in `wrangler.jsonc`, `scheduled()` in `worker/index.ts`) runs
`sweepLobbies()` (`worker/sweep.ts`). It reads index lobbies older than a day, oldest first and
`SWEEP_BATCH` at a time to stay under the per-invocation subrequest limit, and posts
`/lobby/sweep` to each one's DO, which arms the alarm if it is missing or wrong. A DO that answers
404 holds no match, so its index rows are deleted. That also cleans up after a failed
`dissolveLobby()` index delete. Test the handler locally with
`curl "http://localhost:5173/cdn-cgi/handler/scheduled"`.

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
Its seven stages run in a binding order: persist (the record and the turn-wait ledger) → append
events → recompute
`waitingOn`/`deadline` → reconcile the DO alarm → broadcast a per-player snapshot → sync the D1
index → nudge newly-waited-on disconnected players (and the host of a lobby that commit filled). Two rules hold inside it:

- Stages 1–2 are synchronous and protected by the DO input gate. Every stage after the first
  `await` must re-read `this.readMatch()` and recompute via `deriveWaitingAndDeadline()` before
  using either value — another request or an alarm can run to completion across any await. The
  broadcast's name lookup is one of those awaits, so stage 5 builds its snapshots from the record
  `readNamedMatch()` returns, which is re-read after the lookup.
- D1 writes go through `syncIndex()`, which queues onto `dbWriteQueue` and re-reads canonical
  state at its own turn, so the last writer to the queue always writes the latest truth.

`commit()` also auto-finalizes: any state whose `result()` is non-null flips `status` to `"done"`
and appends `match_finished`. Callers only assign `record.state` and call `commit()`.

**Stats come from the index, and waits from a ledger.** `worker/stats.ts` reads everything the
stats page (`/stats`, `GET /api/me/stats`, `GET /api/leaderboard`) and the hub's streaks show,
from D1 only. Results come from `match_players.won`. How long matches waited on whom comes from
`turn_waits`: `MatchDO.trackWaits()` keeps a ledger in the DO's own `waits` table, opening a row
when a player enters `waitingOn` and closing it when they leave (`moved` = 1 when their own action
did it), in `commit()`'s synchronous first stage from the same two `waitingOn`s it persists.
`writeIndexNow()` copies it into the index: an open row on every write, a closed one until one
write of it lands (`synced`). Both sides key a wait by `(match, player, started_at)`. A match under
way before the ledger existed has no row for the wait in flight; the ledger takes it to start at
the previous commit's `updatedAt`, which is what the migration backfilled from
`matches.updated_at`, and `writeIndexNow()` closes as zero-length any open index row the ledger
does not hold, so a mismatch counts once rather than twice or forever. Two counting rules: a
player's record (wins, win streak, rivalries, per-game lines) follows their `stats_since` reset,
like the hub's; a week's boards (champions, wall of shame) and the play streak do not. A finished
match with a NULL `result_kind` counts for neither side. A play streak is UTC days (the daily
games' `dayOf()`) with a move or a daily run, alive through the day after its last one. In SQL,
beware that a HAVING clause resolves an alias that shares a column's name (`won`) to the column.

**The weekly recap** (`worker/recap.ts`) is one English Slack message every Monday at 08:00 UTC
about the seven UTC days before, through the same `postSlackMessage()` as the nudges. It has a
cron of its own in `wrangler.jsonc`, and `scheduled()` tells it from the hourly sweep by comparing
`controller.cron` with `RECAP_CRON`, so the two strings must match (`worker/recap.test.ts` checks).
It claims the week's row in `recaps` before posting and deletes it if Slack refuses, so no week is
posted twice and a failed one can be retried; a week with nothing to say posts nothing. Nicknames
are escaped for Slack (`&`, `<`, `>`), or a nickname could ping the channel. Its jabs are picked by
week, so a re-run reads the same. Like the nudges, it must never throw. Test it locally with
`curl "http://localhost:5173/cdn-cgi/handler/scheduled?cron=0+8+*+*+1"` and a
`SLACK_WEBHOOK_URL` in `.dev.vars`.

**Nudges are one decision and two channels.** `commit()`'s last stage decides _who_ is newly
waited-on, not watching, and past the rate limit (`shouldNudge` in `worker/nudge.ts`: one per
player per match per turn, plus a 10-minute floor under a nudge the player has not answered, with
`nudgedAt` kept on the DO record). A move answers a nudge — `handleAction` drops the mover's
`nudgedAt` entry — so a player who is actually playing hears about every turn, however quick; the
floor only holds back a player whose `waitingOn` keeps flapping while they stay away. A lobby waits
on nobody, so the one nudge `waitingOn` cannot produce has its own trigger: the join that takes a
lobby's last seat (`maxPlayers`) nudges the host, if they are not watching, with kind `lobbyFull`
instead of `turn` — no rate limit, since nobody leaves a lobby and it fills once. It is left out of
`waitingOn` on purpose, since that also drives the hub's `waiting` flag and the app badge. "Watching"
is `MatchDO.isWatching()`: a socket counts only while its page keeps up the heartbeat (below), and
a hidden page closes its socket, so neither a sleeping laptop's leftover socket nor a background
tab spares its player a nudge. Both channels then get that same list, and the roster's names,
each through its own `ctx.waitUntil()` so neither waits on nor is lost to the other. Slack (`worker/nudge.ts`) is one message for the whole batch,
to a shared channel. Web push (`worker/push.ts`) is one encrypted notification per subscribed
device, addressed to that player alone. Neither may throw: they are fired from a path `alarm()`
reaches, and a throw there is retried up to six times.

**Web push is implemented against the RFCs, not a library**, because a Worker has no `web-push`:
VAPID (RFC 8292) is an ES256 JWT signed with `VAPID_PRIVATE_KEY`, and the payload is encrypted
with RFC 8291's `aes128gcm` — an ECDH between a key pair generated per message and the browser's
own key, salted with the subscription's auth secret. Both halves are Web Crypto, and neither is
readable enough to review by eye, so `worker/push.test.ts` checks them the way the other side
would: it verifies the JWT with the public key and decrypts the body by re-deriving RFC 8291's
key schedule in a second implementation that deliberately shares nothing with `worker/push.ts`.
A push service answering 404 or 410 means that subscription is gone for good, and the row is
deleted; anything else is transient and the row stays. Rotating the VAPID key pair invalidates
every existing subscription, because a subscription is bound to the key it was created with.

**A notification is the one player-facing string that cannot go through i18next.** It is composed
in the Worker, in the language the device stored when it subscribed (`push_subscriptions.language`),
from the `COPY` table in `worker/push.ts`, which has one set of strings per nudge kind; a language
`web/locales/` ships and that table lacks is a test failure. The game's name comes from the same locale files the client reads, through
`games/names.ts`. The client sends its language again on every load and every switch, so the row
follows the app. The body names the reader's opponents, never the match code, which is not
something a player reads. The payload carries a path, never `PUBLIC_BASE_URL`, so a misconfigured
base URL cannot send a player to another host. It goes out at `Urgency: high`, since at `normal`
an Android push service may hold it until a dozing phone next wakes on its own.

**Daily games are one run per player per day, in a `DailyDO` of their own.** A daily game
implements `DailyGameModule<S, A>` (`shared/game.ts`) and is registered in `dailyGames`/`dailyUi`
(`games/registry.ts`), which are kept apart from `serverGames`/`gameUi` so neither kind can be
started as the other. A run's Durable Object is named `runName(gameId, day, playerId)`
(`worker/daily.ts`), and that name is the whole of the one-run-a-day rule: a second start finds
the first run and hands it back. A day is a UTC date (`shared/daily.ts`). Start always means today
by the server's clock, while actions and finish carry the run's own day in the path, so a move
sent just after midnight reaches yesterday's run and is refused there (`day_over`). The day's seed
is `daySeed()`: an HMAC of the game and the day under `SESSION_SECRET`, the same for every player
but not derivable from the date. The seed and the PRNG state must never reach `view()`, because
with them a player could see every tile the day will spawn. A run ends by the game's own rules
(`finished()`), when its player ends it (`/finish`), or at midnight. The last two close it as it
stands, with whatever `score()` says. Every route closes an overdue run before touching it, and
the DO alarm does the same at the day's end, so a late alarm never lets a move through. D1's
`daily_runs` is the chart's derived copy, written only when a run starts and when it ends (not on
every move), through a queue like `syncIndex()`'s. A write D1 refuses is retried from the alarm
(`CHART_RETRY_MS`) until it lands. The chart (`worker/chart.ts`) ranks by `score.value` in the
direction the game's `meta.order` says, gives ties a shared rank, and always reports the caller's
own run, even below the listed page. There is no WebSocket, event log or nudge: a run has one
player, and every daily route replies with the run as it now stands. The client
(`web/useDaily.ts`) posts actions one at a time, in order, from a short queue, so a game UI may
call `send` as fast as its player acts.

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
an add-on with backoff, and falls back to HTTP for sends. It holds no socket while the page is
hidden — that is how the server knows a player has looked away — and reconnects the moment it is
shown, with `hello` catching up on what it missed. That order is load-bearing: applying a
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
`"pong"` through `setWebSocketAutoResponse` without waking the DO, and timestamps it
(`ctx.getWebSocketAutoResponseTimestamp()`). The client sends one every `HEARTBEAT_INTERVAL_MS`,
and a socket whose last one (or whose `connectedAt`, before the first) is older than
`PRESENCE_WINDOW_MS` (both in `shared/heartbeat.ts`) no longer counts as its player watching. The app-level `{t:"ping"}`
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
including deep-linked SPA routes like `/m/ABCDEF` and `/daily/2048`, is served by Static Assets
with SPA fallback.

**The app is installable.** `vite build` generates a Workbox service worker (`vite-plugin-pwa`)
into the client output, and only `vite build` does: no dev server registers one, so `npm run dev`,
`npm run e2e:serve` and the Playwright suite behave as if none of this existed — which is also
why push notifications are unreachable in all three, and why `web/push.ts` reports "unavailable"
rather than waiting on a `navigator.serviceWorker.ready` that will never settle. Use
`npm run build && npm run preview` to exercise it. Two rules hold in `vite.config.ts`. Nothing
under `/api` or `/ws` is ever cached — match truth is the DO's, so a cached snapshot is a wrong
board; no runtime-caching rule matches them, and the navigation fallback carries a denylist so an
`/api` URL typed into the address bar is not answered with `index.html`. And a new worker never
activates on its own: `web/components/UpdatePrompt.tsx` registers the worker and offers the
waiting build, because applying one means a reload, and an unasked-for reload lands mid-move. A
player therefore keeps running the build they loaded until they accept that prompt, which matters
because every push to `main` deploys.

The hub offers the install itself (`web/components/InstallPrompt.tsx`, `web/install.ts`), but
only to a player who has a match, and only where installing can actually happen. Chromium
announces an installable page with `beforeinstallprompt`, once per load and usually before the hub
mounts, so `listenForInstallPrompt()` catches it at boot — its `preventDefault()` also holds back
Chrome's own install bar — and the card's button replays it. iOS has no such event and no API, so
the card there says where to tap in the Share sheet. That is the case the card exists for: Safari
only speaks web push inside a Home Screen app, so on an iPhone the bell is not there until the app
is installed, and the card promises notifications only when `/api/push/key` says the deployment
sends them. An app already running standalone is never offered, and "Not now" (or turning down the
browser's dialog) holds for 30 days in `localStorage`. The test browser never sends a real
`beforeinstallprompt`, so `e2e/install.spec.ts` plays the browser: an iPhone device for iOS, and a
dispatched event for Chromium.

The worker's push half is `public/push-sw.js`, pulled in by Workbox's `importScripts` rather than
bundled: Workbox generates the worker's own source, so there is nowhere for app code to live
inside it. That is why it is plain JavaScript with no imports and translates nothing — it renders
the title and body the Worker composed. It must always show a notification (the subscription is
`userVisibleOnly`, so a `push` handler that shows none gets the browser's own "site updated in
the background" instead), and it handles `pushsubscriptionchange` by re-subscribing and POSTing
the new endpoint with the one it replaces, since a push service can retire an endpoint with no
page open to notice. A notification click on an app that is already open does not navigate the
window from the worker: `WindowClient.navigate()` refuses any window the worker does not control
(one force-reloaded past it, say) and is missing in some browsers. The worker posts
`{type: "open", path}` to the page instead, and `followNotificationClicks()` in `web/push.ts`
routes there and replies; `navigate()` and then `openWindow()` are the fallbacks for a page that
does not answer.

The web app manifest is _not_ generated: `public/manifest.webmanifest` is a static file linked
from `index.html`, so it is byte-identical in dev and in production and `e2e/pwa.spec.ts` can
assert it without a production build. It is English-only — a browser reads it once, at install
time, and nothing in it is reachable through `useLanguage()`. Its `theme_color`/`background_color`
and the two `theme-color` metas repeat the dark and light `--surface-void` from `web/styles.css`
as literals, the same duplication the theme bootstrap makes with its storage key; that spec fails
when they drift. The icons are in `public/`: `icon-192.png` and `icon-512.png` are rendered from
`favicon.svg`, and `icon-maskable-512.png` and `apple-touch-icon.png` from `icon.svg`, the
full-bleed variant whose buddy spans about half the canvas — an Android launcher shows only the
middle two thirds of a maskable icon, so a buddy sized just to the 80% safe zone looks zoomed in.
Render them with `sharp` at the target size (`density: 72 * size / 32`), not by upscaling. Both SVGs draw the same buddy
as `web/components/Brand.tsx`, as literals — a plain file cannot import the component — so a
change to the mark has to be made in all three.

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
  registry; the test adds it to `serverGames` and removes it afterwards. `worker/players.test.ts`,
  `worker/hub.test.ts`, `worker/stats.test.ts` and `worker/recap.test.ts` run their SQL against
  the real schema through `worker/__fixtures__/d1.ts`, a D1 mock on `node:sqlite` that applies every `migrations/*.sql` in
  name order. A new migration needs no change there. `worker/daily.test.ts` drives `DailyDO` the
  same way, against `games/__fixtures__/dice.ts`, a test-only daily game it registers in
  `dailyGames` for its own run, with `Date` faked to cross midnight.
- Playwright specs drive the real app (Vite + workerd) through the UI and never import app code.
  `e2e/fixtures.ts` is the harness. `newPlayer(name)` gives each player a browser context of
  their own (with any context options it is passed, such as a `devices` entry), signed in over
  the API as `uniqueNickname(name)` — a nickname is an account and the e2e database outlives a
  run, so two specs sharing a literal would share a player. Assert against
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
  `web/errors.ts` instead. The one player-facing exception is push notification copy, which the
  Worker composes and so cannot read from `web/locales/` — see the notification section above. Playwright pins `locale: "en-US"` because specs match English labels.
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
