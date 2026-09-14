---
plan: 04-engine-core
goal: Implement PLAN.md — async turn-based party games on Cloudflare (Worker + Static Assets + Hono + Durable Objects with SQLite + D1 index + Slack nudges)
status: done
depends_on: [01-scaffolding-and-plumbing, 02-identity-and-match-api]
---

# Engine core: GameModule contract, move pipeline, alarms, event log, hibernated WebSockets

## Objective

Implement the engine described in PLAN.md §4, §5 and §7 inside `MatchDO`: the `GameModule`
contract, the game registry, the post-move pipeline (persist → `waitingOn` → `setAlarm` → broadcast
per-player `view()` → update the D1 index), the append-only event log with `since`-based catch-up,
the alarm-driven `onDeadline` path, and hibernatable WebSockets. No real game ships in this plan —
correctness is proved by a test-only fixture game plus manual WS exercise.

Out of scope: Connect 4 (plan 06), trivia (plan 07), all client code including the `useMatch` hook
(plan 05), Slack nudges (plan 08). The only client touched here is nothing at all.

## Context

- **PLAN.md §5 is the binding interface.** Reproduce it exactly, with one documented addition
  (`actionSchema`, step 2):

  ```ts
  export interface GameModule<S, A> {
    id: string;
    meta: { name: string; minPlayers: number; maxPlayers: number };
    init(players: PlayerId[], seed: number): S;
    reduce(state: S, action: A, by: PlayerId, now: number): S;  // pure + deterministic
    view(state: S, forPlayer: PlayerId): unknown;
    waitingOn(state: S): PlayerId[];          // [] when finished
    deadline(state: S): number | null;        // epoch ms -> schedules the DO alarm
    onDeadline(state: S, now: number): S;     // auto-submit / skip / resolve round
    result(state: S): Result | null;          // non-null => archive
  }
  ```

- **Binding rules from §5:** server-authoritative (clients send intents, never state); zod-validate
  every inbound message; `view()` is mandatory and per-player — never broadcast full state; seeded
  PRNG carried *in state*, never `Math.random()` inside `reduce`; `onDeadline` must be idempotent
  (alarms are at-least-once with up to 6 retries — §10.6), keyed on the round/phase number.
- **Binding pipeline order from §5:** `persist state -> recompute waitingOn -> storage.setAlarm(deadline)
  -> broadcast per-player views -> update D1 index -> nudge newly-waited-on players who are not
  connected`. The nudge hook is a no-op stub in this plan; plan 08 fills it in.
- **§10 gotchas that bite here:** use the Hibernation API (`ctx.acceptWebSocket()` +
  `webSocketMessage`/`webSocketClose`/`webSocketError` handlers), **never** `ws.addEventListener`,
  or idle lobbies bill ~450 GB-s/hour; hibernation wipes in-memory state, so persist on mutation and
  rehydrate from storage; per-connection data (player id, nickname) goes on
  `ws.serializeAttachment()`; **never** `setInterval` — use `storage.setAlarm()`; 10 ms CPU on free,
  so keep reducers small.
- Existing code from plan 02: `MatchRecord` (with `seed` and `state: unknown | null`) persisted as
  JSON in the DO's `meta` table; `syncIndex()` upserting D1; internal DO routes `POST /lobby/create`,
  `POST /lobby/join`, `GET /snapshot`; `games/catalog.ts` with a hardcoded `GAME_CATALOG`.
- §7: the client stores its last `seq`, sends `{ since: seq }` on connect, and receives the delta
  plus a fresh `view()`. WS is an optimization over "fetch state on load", never the only path — so
  the HTTP snapshot route must serve the same payload shape as the WS snapshot message.

## Steps

1. `shared/prng.ts` — a pure seeded PRNG (mulberry32 or xorshift32). API:
   `nextUint32(s: number): [value: number, next: number]`, `nextInt(s, maxExclusive)`,
   `shuffle<T>(items: T[], s: number): [T[], number]`. No hidden module-level state; the caller
   threads the seed through and stores it in game state. Unit-test determinism.
2. `shared/game.ts` — the `GameModule<S, A>` interface verbatim from §5, plus:
   - `Result` type: `{ kind: "win"; winners: PlayerId[] } | { kind: "draw" } | { kind: "scores";
     scores: Record<PlayerId, number> }`.
   - `actionSchema: z.ZodType<A>` as a required member, so the DO can validate intents without
     knowing the game (§5 rule 1). Document the addition in a comment as a deliberate extension.
   - A `GameMeta` re-export so `games/catalog.ts` can derive from modules.
3. `games/registry.ts` (§9) — two maps:
   - `serverGames: Record<string, GameModule<any, any>>`, statically imported (the Worker bundle
     must contain all rules).
   - `gameUi: Record<string, () => Promise<{ default: React.ComponentType<GameUiProps> }>>` using
     dynamic `import()` so the client bundle does not grow linearly with the catalog (§9). Declare
     `GameUiProps` here or in `shared/protocol.ts`; plan 05 consumes it, plans 06/07 implement it.
   - `getGame(id)` returning `GameModule | undefined`.
   - Both maps are **empty** at the end of this plan (or contain only real games if a later plan has
     already landed). Registering a game must be a one-line change (§12 step 7).
   - The server map must not import any `.tsx` file, or the Worker bundle pulls in React.
4. Rewrite the body of `games/catalog.ts` so `GAME_CATALOG` is derived from `serverGames`
   (`Object.values(serverGames).map(g => ({ id: g.id, ...g.meta }))`), keeping the exact exports
   `GameMeta`, `GAME_CATALOG`, `getGameMeta` that plan 02 established. With an empty registry the
   catalog is empty — that is correct and temporary.
5. `shared/protocol.ts` — add the wire protocol with zod schemas for every client→server message:
   - C→S: `{ t: "hello", since: number }`, `{ t: "action", action: unknown }`, `{ t: "start" }`,
     `{ t: "ping" }`.
   - S→C: `{ t: "snapshot", seq, status, players, view, waitingOn, deadline, result }`,
     `{ t: "events", events: { seq, ts, payload }[] }`, `{ t: "error", code, message }`,
     `{ t: "pong" }`.
   - A shared `MatchSnapshot` type used by **both** the WS `snapshot` message and the HTTP snapshot
     route (§7: HTTP is the always-available path).
   - Bump `PROTOCOL_VERSION`.
6. `worker/match.ts` — event log. Add to the constructor's schema bootstrap, verbatim from §7:
   `CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, payload
   TEXT)`. Helpers: `appendEvent(payload: object): number` (returns the new seq) and
   `eventsSince(seq: number, limit = 200)`. Events to append: `player_joined`, `match_started`,
   `action` (`{ by, action }`), `deadline_resolved` (`{ round }`), `match_finished` (`{ result }`).
   Payload is JSON text. **Events must never contain hidden information** — they are replayed to all
   players; anything secret stays in state and reaches players only through `view()`.
7. `worker/match.ts` — the move pipeline. Implement a single private method
   `private async commit(rec: MatchRecord, events: object[]): Promise<void>` that runs the §5 order
   exactly:
   1. persist `rec` (state + `updatedAt`) to the `meta` table,
   2. append `events` to the log,
   3. compute `waitingOn(state)` and `deadline(state)`,
   4. `ctx.storage.setAlarm(deadline)` when non-null, `deleteAlarm()` when null (and always
      reconcile against `getAlarm()` so a stale alarm is not left behind),
   5. broadcast a per-player `snapshot` to every connected socket using that socket's own
      `view(state, playerId)` — N tailored messages, not one shared payload (§5 rule 2), plus the
      new events,
   6. `syncIndex()` — update D1 `matches` (`status`, `updated_at`, `deadline`) and
      `match_players.waiting` (1 for ids in `waitingOn`, else 0),
   7. call `await this.nudgeHook(rec, newlyWaiting)` — a private method whose body is
     `/* plan 08 */ return;` for now, with `newlyWaiting` computed as `waitingOn` minus the previous
     `waitingOn`. Compute and pass it correctly now so plan 08 is a one-method change.
   Every mutation path (`join`, `start`, `action`, `alarm`) must funnel through `commit`.
8. `worker/match.ts` — `POST /start`: host-only, validates player count against the module's
   `meta.minPlayers`/`maxPlayers`, sets `status = "active"`, calls `init(playerIds, rec.seed)`, then
   `commit`. Rejects if already started.
9. `worker/match.ts` — action handling: resolve the module by `rec.gameId`; 400 if unknown; parse
   the raw action with `module.actionSchema`; reject with `{ t: "error", code: "not_your_turn" }` if
   `by` is not in `waitingOn(state)`; reject if `status !== "active"`; else
   `state = reduce(state, action, by, Date.now())` and `commit`. `reduce` throwing a rules violation
   must become a 4xx / `error` message, never a 500 or a corrupted state — wrap it and leave the
   previous state persisted.
10. `worker/match.ts` — `async alarm()`:
    - read the record; if `status !== "active"` or state is null, return without rescheduling;
    - `const due = deadline(state)`; if `due === null` return; if `Date.now() < due`, re-`setAlarm`
      and return (spurious/early fire);
    - else `state = onDeadline(state, now)` and `commit` with a `deadline_resolved` event.
    - **Idempotency (§5 rule 4, §10.6):** the guard is that `onDeadline` is keyed on the round/phase
      number inside the game module and re-running it on an already-resolved round is a no-op.
      Document that contract in `shared/game.ts` as a requirement on implementers, and additionally
      make the DO tolerate a re-entrant alarm (if `deadline(state)` is unchanged after
      `onDeadline`, log and do not loop).
    - After `result(state) !== null`, set `status = "done"`, clear the alarm, clear every
      `match_players.waiting`, and append `match_finished`.
11. `worker/match.ts` — hibernatable WebSockets:
    - `GET /ws` internal route: `new WebSocketPair()`, `this.ctx.acceptWebSocket(server)`,
      `server.serializeAttachment({ playerId, nickname })`, return 101 with the client socket.
    - `webSocketMessage(ws, msg)`: parse with the zod C→S union; `hello` → reply with a fresh
      `snapshot` plus `eventsSince(since)`; `action` → the step 9 path; `start` → step 8;
      `ping` → `pong`. Unknown/invalid → `error` message, and do not throw (a throw kills the
      socket).
    - `webSocketClose` / `webSocketError`: close cleanly; nothing to clean up because there is no
      in-memory connection map — always enumerate with `ctx.getWebSockets()` and read
      `deserializeAttachment()`.
    - Add `webSocketAutoResponse` via `ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(
      "ping", "pong"))` **or** the `ping` message handler, not both; prefer the auto-response pair so
      keepalives never wake the DO, and say so in a comment.
    - Helper `isConnected(playerId): boolean` over `ctx.getWebSockets()` — plan 08 needs it.
12. `worker/index.ts` — `GET /ws/:id` (§3): require a session, verify via the DO that the caller is a
    player in that match, check `Upgrade: websocket` (426 otherwise), then forward the request to the
    DO stub with the player id and nickname attached as headers. Also expose
    `GET /api/matches/:id/snapshot` and `POST /api/matches/:id/actions` (HTTP fallbacks serving the
    same `MatchSnapshot` and the same action pipeline) so §7's "never the only path" holds.
13. Tests — `games/__fixtures__/counter.ts`: a **test-only** game module (do **not** register it in
    `games/registry.ts`) exercising both phase types from §4: a sequential phase where each player
    increments in turn, then a simultaneous phase with a deadline where non-submitters get 0 on
    `onDeadline`. Test in `games/__fixtures__/counter.test.ts` and `shared/prng.test.ts`:
    - `reduce` is pure (same inputs → deeply equal outputs; input state not mutated),
    - PRNG determinism for a fixed seed,
    - `waitingOn` is `[]` exactly when `result()` is non-null,
    - `onDeadline` applied twice to the same state yields a state whose second application is a
      no-op (idempotence),
    - `view()` for player A does not contain player B's hidden field.
14. `README.md` — add a short "Engine" section: the pipeline order, the four `GameModule` rules, and
    a one-line statement that a new game = a folder under `games/` plus one line in
    `games/registry.ts`.

## Acceptance criteria

- [ ] `npm run typecheck`, `npm test`, `npm run build` pass.
- [ ] `shared/game.ts` matches PLAN.md §5's interface member-for-member, plus the documented
      `actionSchema` addition.
- [ ] `MatchDO` uses `ctx.acceptWebSocket` and the `webSocketMessage`/`webSocketClose`/
      `webSocketError` handlers; `grep -r "addEventListener" worker/` returns nothing.
- [ ] `grep -rn "setInterval" worker/ shared/ games/` returns nothing.
- [ ] Per-connection identity is stored via `serializeAttachment`, not an in-memory map.
- [ ] Every broadcast calls `view(state, playerId)` per socket; no code path sends raw `state` to a
      client.
- [ ] `commit()` performs the seven pipeline stages in PLAN.md §5's order, and every mutation path
      goes through it.
- [ ] The `events` table matches §7's DDL exactly; `hello { since }` returns only events with
      `seq > since` plus a fresh snapshot.
- [ ] Alarms are set via `storage.setAlarm` and cleared when `deadline()` is null; a second alarm
      fire on an already-resolved round changes nothing (covered by the fixture test).
- [ ] `Math.random()` appears in no reducer or game module (only in seed creation, which lives in
      `worker/match.ts` from plan 02).
- [ ] The fixture game is not present in `games/registry.ts`; `serverGames` is still empty.
- [ ] Invalid or hostile WS payloads produce an `error` message and never throw out of
      `webSocketMessage`.

## Verification

```bash
cd /home/stefano/workspace/party-dev
npm run typecheck && npm test && npm run build
npm run db:migrate:local
npm run dev
```

With no game registered, verify the plumbing rather than gameplay:

```bash
curl -s -c /tmp/a.txt -X POST localhost:5173/api/identity -H 'content-type: application/json' -d '{"nickname":"alice"}'
curl -s -b /tmp/a.txt -X POST localhost:5173/api/matches -H 'content-type: application/json' -d '{"gameId":"nope"}'   # => 400 unknown game
curl -s -b /tmp/a.txt localhost:5173/api/games   # => [] (registry empty, catalog derived)
```

Then, in the browser devtools console on the running SPA (a match created before plan 04's catalog
change, or one inserted by hand), open `new WebSocket("ws://localhost:5173/ws/<CODE>")`, send
`{"t":"hello","since":0}` and confirm a `snapshot` message comes back with `players` and a null
`view`; send `{"t":"nonsense"}` and confirm an `error` message arrives and the socket stays open.
Confirm in the dev server log that the DO is not billing idle time (no repeated wakeups while the
socket sits open).

The full end-to-end gameplay proof is plan 06's job; this plan's bar is "the pipeline is correct and
the unit tests for the two phase types pass".

## Risks / notes

- **This is the largest plan in the series.** If it must be trimmed, the HTTP action fallback (step
  12's `POST /api/matches/:id/actions`) is the only piece that may slip — everything else is load
  bearing for plans 05–08.
- **Registry emptiness:** after step 4, `GAME_CATALOG` is `[]`, so plan 03's create form has no
  options until plan 06 lands. That is expected; do not re-hardcode the catalog to hide it.
- **10 ms CPU (§2/§10.5):** the broadcast loop is O(players) `view()` calls plus JSON serialization.
  Fine for ≤8 players; note the limit in a comment near the loop.
- **Alarm retries (§10.6):** a throw inside `alarm()` is retried up to 6 times with backoff. Never
  let a D1 index failure throw out of `alarm()` — log it and continue; the index is derived and can
  be repaired, but a retry storm double-resolves rounds.
- **Row-write budget (§2):** one D1 upsert per move per player. At the plan's projected ~500
  moves/day this is nowhere near the 100k/day cap; do not add per-event D1 writes.
- Keep the `Result` shape stable — plans 06, 07 and the dashboard's "Finished" bucket all read it.
