---
plan: 05-client-match-transport
goal: Implement PLAN.md — async turn-based party games on Cloudflare (Worker + Static Assets + Hono + Durable Objects with SQLite + D1 index + Slack nudges)
status: done
depends_on: [03-dashboard-spa, 04-engine-core]
---

# Client match transport: WS + backoff + since-resync + lazy game UI host

## Objective

Give the SPA a live connection to a match: a `useMatch(matchId)` hook that loads an HTTP snapshot
first, then upgrades to a hibernation-friendly WebSocket, reconnects with exponential backoff after
laptop sleep, and resyncs by `{ since: seq }` (PLAN.md §7). `MatchPage` becomes the generic host:
start button, turn indicator, history panel, and a lazily imported per-game UI from the registry —
with a raw-JSON debug view when no UI is registered.

Out of scope: any game rules or game-specific UI (plans 06/07), Slack nudges and the tab-title badge
(plan 08), client-side prediction via shared `reduce` (explicitly deferred — see Risks).

## Context

- Plan 04 defines, in `shared/protocol.ts`: the C→S messages `hello`/`action`/`start`/`ping`, the
  S→C messages `snapshot`/`events`/`error`/`pong`, the shared `MatchSnapshot` type, and
  `GameUiProps`. **Read that file first and conform exactly** — do not invent message names.
- Plan 04 exposes `GET /ws/:id` (session-authenticated upgrade), `GET /api/matches/:id/snapshot`
  and `POST /api/matches/:id/actions` returning the same `MatchSnapshot`.
- Plan 04's `games/registry.ts` exports `gameUi: Record<string, () => Promise<{ default:
  React.ComponentType<GameUiProps> }>>` for lazy client loading (§9: the bundle must not grow
  linearly with the catalog). **Both registry maps are still empty when this plan starts** — the
  first real game lands in plan 06. Plan 04 also left a test-only fixture module at
  `games/__fixtures__/counter.ts` that is deliberately unregistered; see Verification for how to use
  it temporarily.
- Plan 03 left a marked seam in `web/routes/MatchPage.tsx` (`<MatchBody match={...} />`) for exactly
  this work, plus `web/api.ts`, `web/session.tsx` and the hand-rolled router in `web/router.tsx`.
- **§7 is binding:** WS is an optimization over "fetch state on load", never the only path. If the
  socket never opens, the page must still be fully usable through HTTP snapshot + action POST.

## Steps

1. `web/useMatch.ts` — the transport hook. State machine, explicit and small:
   - On mount: `GET /api/matches/:id/snapshot` → render immediately. Never show a blank page waiting
     for a socket.
   - Then open `new WebSocket` to `/ws/:id` (derive `ws://`/`wss://` from `location.protocol`) and
     send `{ t: "hello", since }` where `since` is the highest `seq` seen so far (0 on first load).
   - Handle `snapshot` (replace view state), `events` (append to a bounded history buffer, cap ~200,
     advance `since`), `error` (surface to the UI; distinguish `not_your_turn` from fatal), `pong`.
   - Reconnect with exponential backoff **with jitter**: 1 s → 2 s → 4 s … cap 30 s, reset on a
     successful `hello` round trip. Reconnect immediately (bypassing the backoff timer) on
     `visibilitychange` → visible and on `online` — this is the laptop sleep/wake case from §7.
   - Send `{ t: "action", action }` over the socket when open; when it is not open, fall back to
     `POST /api/matches/:id/actions` and then refetch the snapshot. The caller must not care which
     path was used.
   - Return `{ snapshot, events, connection: "connecting" | "live" | "offline", error, send(action),
     start() }`.
   - Clean up on unmount: close the socket, clear timers. No leaked reconnect loops when navigating
     between matches.
2. `web/components/TurnIndicator.tsx` — renders the §4 answer to "who is the game waiting on":
   "Your turn", "Waiting on <names>", or the finished result. Also renders the deadline as a live
   countdown when `snapshot.deadline` is non-null (a `setInterval` in the browser is fine — the
   §10.4 ban is Durable-Object-only; note that in a comment).
3. `web/components/HistoryPanel.tsx` — a collapsible list of the event log from §7, newest first,
   rendering `{ seq, ts, payload }` generically (it must not assume game-specific payload shapes).
4. `web/components/ConnectionBadge.tsx` — small live/reconnecting/offline indicator, so a stalled
   socket is visible rather than mysterious.
5. `web/routes/MatchPage.tsx` — wire the hook into the plan 03 seam:
   - `lobby` status: existing lobby view plus a **Start** button, enabled only for the host and only
     when the player count is within the game's min/max, calling `start()`.
   - `active`/`done`: `TurnIndicator`, the game UI, `HistoryPanel`, `ConnectionBadge`.
   - Game UI resolution: look up `gameUi[snapshot.gameId]`, wrap in `React.lazy` + `<Suspense>` with
     a loading fallback and an error boundary so a broken game module cannot white-screen the app.
     When there is no registered UI, render `web/components/DebugGameView.tsx`.
6. `web/components/DebugGameView.tsx` — a `<pre>` of `snapshot.view` plus a textarea where a JSON
   action can be typed and sent via `send()`. This is the generic proof that the engine works before
   any real game exists, and it stays in the tree afterwards as a debugging aid (reachable only when
   no game UI is registered).
7. `GameUiProps` contract (defined in plan 04, consumed here): `{ view: unknown; me: PlayerId;
   players: PlayerInfo[]; waitingOn: PlayerId[]; deadline: number | null; result: Result | null;
   send: (action: unknown) => void }`. If plan 04's shape differs, **conform to plan 04** and adjust
   this list; do not change the shared type from the client side without updating
   `shared/protocol.ts`.
8. Dashboard integration: when `useMatch` receives any `snapshot`, invalidate the cached dashboard
   list so a return to `/` shows fresh buckets. A simple "refetch on route change to `/`" is
   sufficient; do not add a state-management library.
9. `web/styles.css` — styles for the turn indicator (accent when it is your turn), the countdown, the
   history panel and the connection badge.

## Acceptance criteria

- [ ] `npm run typecheck`, `npm test`, `npm run build` pass.
- [ ] The match page renders from the HTTP snapshot before the WebSocket connects; with the socket
      blocked entirely, the page still loads and actions still work via the HTTP fallback.
- [ ] `hello` sends the highest seen `seq`; after a forced disconnect and reconnect, only the missed
      events arrive and the history has no duplicates or gaps.
- [ ] Reconnect backoff is exponential with jitter, capped at 30 s, and resets after a successful
      reconnect; returning to the tab reconnects immediately.
- [ ] Unmounting the match page closes the socket and leaves no pending timers (verify by navigating
      away and watching devtools).
- [ ] Game UI is loaded via dynamic `import()` from `games/registry.ts`, inside `Suspense` and an
      error boundary; an unregistered game falls back to `DebugGameView` rather than crashing.
- [ ] The client never sends state — only actions (`shared/protocol.ts` message shapes only).
- [ ] `games/registry.ts` is **unchanged** by this plan's committed diff (still no registered games).
- [ ] No new runtime dependencies.

## Verification

```bash
cd /home/stefano/workspace/party-dev
npm run typecheck && npm test && npm run build
npm run db:migrate:local
npm run dev
```

Manual exercise needs a playable match, and the registry is empty until plan 06. Use a **scratch
edit that must be reverted before committing**: temporarily add the plan-04 fixture
(`games/__fixtures__/counter.ts`) to `serverGames` in `games/registry.ts`, run the checks below, then
`git checkout games/registry.ts` and re-run `npm run build`. Confirm with `git status` that the final
diff does not touch `games/registry.ts`.

With the fixture temporarily registered, in two browser profiles:

1. Alice creates a "counter" match, Bob joins by code, Alice presses **Start**. Both see
   `DebugGameView` (no UI registered for the fixture) and a turn indicator.
2. Alice sends a valid action JSON from the debug view: both windows update live; the history panel
   gains an event. Bob sending out of turn yields a `not_your_turn` error and no state change.
3. Connection badge goes `connecting` → `live`.
4. Kill the dev server: the badge goes `offline` and reconnect attempts visibly back off; restart the
   server and the badge returns to `live` without a page reload, with no duplicated history entries.
5. Devtools → Network → set offline then online: reconnect fires immediately on `online`.
6. Switch tabs for a minute and return: an immediate reconnect whose `hello` carries the last `seq`,
   and only the missed events arrive.
7. Block the WS endpoint (devtools request blocking on `/ws/*`): the page still loads from the HTTP
   snapshot and an action still succeeds via the POST fallback.
8. Navigate to `/` and back: exactly one socket is open (devtools → Network → WS).

## Risks / notes

- **Client-side prediction is deliberately not implemented here.** PLAN.md §1/§5 note that sharing
  `reduce` enables instant feedback, but running the reducer optimistically needs rollback handling.
  Ship server-authoritative round trips first; prediction is a later, separate change. Do not
  smuggle it in.
- **React 19 StrictMode double-mounts effects in dev**, which will open two sockets and can look
  like a bug. Make the effect idempotent/cleanup-correct rather than disabling StrictMode.
- A `snapshot` arriving out of order after a reconnect can clobber newer state. Guard by ignoring a
  snapshot whose `seq` is lower than the current one.
- The history buffer must be bounded — a long match with hundreds of events should not grow the tab
  without limit.
- Do not add a heartbeat `ping` from the client if plan 04 configured `setWebSocketAutoResponse`;
  duplicate keepalives waste the 20:1-billed inbound message budget (§2).
