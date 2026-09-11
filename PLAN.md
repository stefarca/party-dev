# party-dev — Technical Plan

A collection of small games for playing with coworkers, hosted on Cloudflare's free tier.
Turn-based / round-based, **async-first**: a match must survive a player disappearing into a
meeting for an hour.

Status: planning. Nothing implemented yet.

---

## 1. Stack

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere |
| Frontend | Vite + React (Svelte if bundle size becomes a concern) |
| Hosting | Single Cloudflare Worker with Static Assets |
| Server routing | Hono |
| Realtime | Durable Objects + WebSocket Hibernation API |
| Match state | The DO's own SQLite (authoritative) |
| Match index | D1 (derived, for dashboard queries only) |
| Nudges | Slack incoming webhook |
| Optional | `partyserver` to skip room-routing boilerplate |

**Why TypeScript is non-negotiable:** game rules are a pure reducer, and we want to run the
*same file* on the server (authority) and on the client (instant feedback). Rust/Go via WASM
loses that and the Durable Object ergonomics with it.

---

## 2. Platform constraints (verified 2026-09-11)

- **Static assets: free and unlimited.** SPA, JS, CSS, images cost nothing. Only Worker
  invocations bill.
- **Workers free:** 100k requests/day, 10 ms CPU per invocation, 100 Workers/account.
- **Durable Objects free:** available on the free plan but **SQLite-backed classes only**;
  100k requests/day, 13,000 GB-s/day, 5M rows read + 100k rows written/day, 5 GB.
- **WebSockets:** outgoing messages free; incoming billed at **20:1**.
- **D1 free:** 5 GB, 5M rows read/day, 100k rows written/day.

### Budget math

Duration is normally the binding constraint: 13,000 GB-s ÷ 0.125 GB (128 MB resident) =
~104,000 DO-seconds/day ≈ **29 room-hours/day**.

Async turn-based play makes that irrelevant. The DO wakes ~10 ms per move, then hibernates.

    10 players x 50 moves/day = 500 moves
    500 x 0.01s x 0.125 GB   = ~0.6 GB-s/day   (of 13,000)
    500 requests              (of 100,000)

**~0.005% of the free tier.** Stop optimizing for cost; optimize for the async UX problem —
*"it has been your turn for 40 minutes and you don't know."*

---

## 3. Architecture

    Browser --HTTP--> Worker (Hono)
                       |- /*          -> static assets (free, unlimited)
                       |- /api/*      -> match create/join, dashboard
                       `- /ws/:id     -> upgrade, forward to DO
                                          |
                                    MatchDO (idFromName(matchId))
                                    |- hibernatable WebSockets
                                    |- game reducer + state
                                    |- SQLite: state + event log
                                    `- alarms: phase deadlines
                                          |
                                    D1 (index): which matches wait on whom

**One DO class for all games.** The game id is a field in match state. Adding game #7 touches
zero infrastructure — that is the whole payoff. Do *not* create one Worker or one DO namespace
per game.

**Single-player games need no backend at all** — pure client-side, served from static assets,
zero quota consumed. Only involve the DO when a second person is.

---

## 4. The core abstraction: two phase types

Nearly every async party game is one of these, or alternates between them:

| | **Sequential** | **Simultaneous + deadline** |
|---|---|---|
| Who acts | one player | everyone at once |
| Advances when | that player moves | all submitted, **or** deadline fires |
| Needs alarm | only for skip-timeout | always |
| Examples | Connect 4, chess, drawing-telephone, Codenames clues | trivia round, voting, werewolf night |

Support exactly these two and the whole catalog is covered. Both hinge on one question:
**who is the game waiting on?** That single answer drives the turn indicator, the dashboard,
and the nudges.

---

## 5. Game module contract

```ts
export interface GameModule<S, A> {
  id: string;
  meta: { name: string; minPlayers: number; maxPlayers: number };

  init(players: PlayerId[], seed: number): S;
  reduce(state: S, action: A, by: PlayerId, now: number): S;  // pure + deterministic
  view(state: S, forPlayer: PlayerId): unknown;               // per-player projection

  // async
  waitingOn(state: S): PlayerId[];          // [] when finished
  deadline(state: S): number | null;        // epoch ms -> schedules the DO alarm
  onDeadline(state: S, now: number): S;     // auto-submit / skip / resolve round
  result(state: S): Result | null;          // non-null => archive
}
```

### Rules

1. **Server-authoritative.** Clients send *intents*, never state. Validate every inbound
   message with zod — coworkers will open devtools.
2. **`view()` is mandatory, not optional.** Broadcasting full state leaks hidden information
   (cards, the impostor, the secret word). Project per-player and send N tailored messages;
   outgoing is free, so there is no cost argument against it.
3. **Seeded PRNG in state, never `Math.random()` inside `reduce`.** Determinism buys replay,
   reconnect-by-replay, and client-side prediction.
4. **`onDeadline` must be idempotent.** Alarms are at-least-once with up to 6 retries on throw.
   Key it on the round/phase number and no-op if that round already resolved, or a transient
   failure double-resolves a round.

### Move pipeline

After every `reduce`, the DO runs:

    persist state -> recompute waitingOn -> storage.setAlarm(deadline)
      -> broadcast per-player views -> update D1 index
      -> nudge newly-waited-on players who are not connected

`onDeadline` is what makes meetings survivable: a trivia round resolves scoring non-answerers
zero, a chess turn auto-passes after 24h, werewolf night resolves with abstentions. The game
never wedges because someone went to a standup.

---

## 6. Match index (D1)

DOs are not enumerable, so *"which matches are waiting on me?"* has no answer without an index.
That dashboard is the entire async UX, so this is not optional.

```sql
CREATE TABLE matches (
  id TEXT PRIMARY KEY, game_id TEXT, status TEXT,   -- lobby|active|done
  created_at INTEGER, updated_at INTEGER, deadline INTEGER
);
CREATE TABLE match_players (
  match_id TEXT, player_id TEXT, waiting INTEGER,   -- 1 = it is on them
  PRIMARY KEY (match_id, player_id)
);
CREATE INDEX idx_waiting ON match_players(player_id, waiting);
```

Home screen = one query: *your turn (n)* / *waiting on others* / *finished*.

D1 is **derived state**. The DO is the single source of truth; if they disagree, the DO wins.
Writes are ~500/day against a 100k/day budget.

*Simpler alternative considered:* a singleton index DO. One less binding, but a single hot
object and every query hand-rolled. D1 wins because SQL over the index is free.

---

## 7. Reconnect and catch-up

A player reloads hours later and needs "what happened while I was gone." Append-only log in the
DO's SQLite:

```sql
CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, payload TEXT);
```

Client stores its last `seq`; on connect it sends `{ since: seq }` and receives the delta plus a
fresh `view()`. Gives a replay/history panel for free — and is why `reduce` must be
deterministic with a seeded PRNG.

WebSockets stay primary (hibernated sockets cost nothing, and give live play when two people are
both at their desks), but the client must handle laptop sleep/wake: reconnect with exponential
backoff, resync by `since`. **Treat WS as an optimization over "fetch state on load", never as
the only path.**

---

## 8. Nudges

The actual product problem, in order of effort:

1. **Slack incoming webhook** — one `fetch()` to a secret URL. The office already lives there,
   it reaches people in meetings, ~10 lines. Do this first.
2. **Tab title + favicon badge** — `(2) Party` while the tab is open. ~20 minutes.
3. **Web Push** — works with the tab closed, but needs a service worker, VAPID keys and
   subscription storage. Later, not v1.

Rate-limit: one nudge per player per match per turn, tracked via `nudged_at` on the match row.
Nothing burns goodwill faster than a bot pinging the channel every 30 seconds.

---

## 9. Repo layout

    party-dev/
    |- wrangler.jsonc
    |- shared/protocol.ts        # message types + zod schemas
    |- worker/
    |  |- index.ts               # Hono: /api, WS upgrade, asset fallthrough
    |  `- match.ts               # MatchDO
    |- games/
    |  |- registry.ts            # id -> module (server), id -> lazy import (client)
    |  |- connect4/{game.ts, ui.tsx}
    |  `- trivia/{game.ts, ui.tsx}
    `- web/                      # Vite + React SPA

Each game co-locates rules and UI. Client UI is lazy-loaded via dynamic `import()` from the
registry so the bundle does not grow linearly with the number of games.

```jsonc
// wrangler.jsonc
{
  "name": "party-dev",
  "compatibility_date": "2026-09-01",
  "main": "worker/index.ts",
  "assets": {
    "directory": "./dist/client",
    "not_found_handling": "single-page-application"
  },
  "durable_objects": { "bindings": [{ "name": "MATCH", "class_name": "MatchDO" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["MatchDO"] }],
  "d1_databases": [{ "binding": "DB", "database_name": "party", "database_id": "TBD" }]
}
```

Use `@cloudflare/vite-plugin` for dev — it runs the real `workerd` runtime locally, DOs
included, so we are not testing against a mock.

---

## 10. Gotchas

1. **`new_sqlite_classes`, not `new_classes`** in migrations. KV-backed DO storage is paid-plan
   only; the wrong key gets rejected on the free plan.
2. **Use the Hibernation API** (`state.acceptWebSocket()` + `webSocketMessage()` handlers), not
   `ws.addEventListener`. Otherwise idle lobbies bill ~450 GB-s/hour for nothing.
3. **Hibernation wipes in-memory state.** Persist to `ctx.storage` on mutation, rehydrate in the
   constructor. Small per-connection data (player id, nickname) goes on
   `ws.serializeAttachment()`.
4. **Never `setInterval`** — it pins the DO in memory. Use `storage.setAlarm()`.
5. **10 ms CPU on free** — keep reducers small.
6. **Alarms are at-least-once** — see the idempotency rule in §5.
7. **Auth:** no passwords. Nickname + HMAC-signed cookie (Web Crypto, key in a Worker secret) is
   enough to survive reconnects in an office.

---

## 11. Rejected alternatives

| Option | Why not |
|---|---|
| Next.js on Workers | SSR pointless for a game client; real build complexity |
| KV for match state | Eventually consistent, seconds of lag. Wrong primitive. |
| D1 for match state | No push; DO is the natural authority. D1 stays an index. |
| One Worker per game | Fragments routing, burns the 100-Worker account limit |
| Rust/Go via WASM | Loses shared client/server rules and DO ergonomics |
| Colyseus / socket.io on a VPS | Costs money; the brief is free hosting |

---

## 12. Build order

1. Worker + static assets + D1 + an empty `MatchDO`, deployed. Prove the free-tier plumbing
   end to end.
2. Identity (nickname + signed cookie), match create/join by code, **the dashboard**.
   This *is* the app — get it right before any game exists.
3. Engine: `reduce` + `waitingOn` + alarm-driven `onDeadline`, plus the event log.
4. One **sequential** game: **Connect 4**. Trivial rules, proves turn handoff end to end.
5. One **simultaneous** game: **trivia round**. Proves deadlines and auto-resolve.
6. Slack nudges.
7. Content: each new game is a folder plus a registry line.

Steps 4 and 5 are deliberately boring games — they exist to prove the two phase models. Once
both are green, the interesting games are just rules.

### Candidate games (post-engine)

Sequential: Connect 4, drawing-telephone, Codenames, chess-likes.
Simultaneous: trivia, would-you-rather polls, Wavelength-likes, werewolf day/night phases.
Poor fit (needs reaction time): anything live-drawing or buzzer-based.

---

## Sources

- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/durable-objects/api/alarms/
- https://github.com/cloudflare/partykit/tree/main/packages/partyserver
