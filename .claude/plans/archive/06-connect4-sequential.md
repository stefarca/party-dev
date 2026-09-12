---
plan: 06-connect4-sequential
goal: Implement PLAN.md — async turn-based party games on Cloudflare (Worker + Static Assets + Hono + Durable Objects with SQLite + D1 index + Slack nudges)
status: done
depends_on: [04-engine-core, 05-client-match-transport]
---

# Connect 4 — the sequential phase type, end to end

## Objective

Ship the first real game: Connect 4 as `games/connect4/{game.ts, ui.tsx}`, registered with one line
in `games/registry.ts`. Its purpose (PLAN.md §12 step 4) is to prove the **sequential** phase type
from §4 end to end: one player acts, `waitingOn` hands the turn over, the dashboard's "your turn"
bucket lights up for the right person, and the match archives with a `result`.

Out of scope: trivia and the simultaneous phase type (plan 07), Slack nudges (plan 08), animations,
AI opponents, rematch flows, spectators.

## Context

- `shared/game.ts` (plan 04) holds the `GameModule<S, A>` interface from PLAN.md §5 plus the
  `actionSchema` member and the `Result` type. `shared/prng.ts` holds the seeded PRNG.
  `games/registry.ts` holds `serverGames` (static imports, server rules) and `gameUi` (lazy
  `import()` for the client). `games/catalog.ts` derives `GAME_CATALOG` from `serverGames`.
- `GameUiProps` (plan 04, consumed by plan 05's `MatchPage`): `{ view, me, players, waitingOn,
  deadline, result, send }`. Read the real definition before writing `ui.tsx`.
- **Binding §5 rules:** `reduce` is pure and deterministic; no `Math.random()`; `view()` is
  mandatory; `onDeadline` must be idempotent, keyed on the phase/turn number.
- **§10.5:** 10 ms CPU per invocation on the free plan. A 7×6 win check is trivial — keep it to the
  four directions from the last placed disc, not a full-board scan.
- `game.ts` must not import React or anything from `web/`; it is bundled into the Worker.

## Steps

1. `games/connect4/game.ts` — state and rules:
   - `type C4State = { board: (0 | 1 | null)[][] /* 6 rows x 7 cols, or a flat 42 array */;
     players: [PlayerId, PlayerId]; turn: 0 | 1; turnNo: number; lastMove: { col: number; row: number
     } | null; winner: 0 | 1 | null; draw: boolean; startedAt: number; turnStartedAt: number;
     rng: number }`.
   - `init(players, seed)`: require exactly 2 players; use `shared/prng.ts` with `seed` to decide who
     moves first, storing the advanced rng value in state (this is the §5 rule 3 demonstration —
     even a trivial use must go through the seeded PRNG).
   - `actionSchema`: `z.object({ t: z.literal("drop"), col: z.number().int().min(0).max(6) })`.
   - `reduce(state, action, by, now)`: reject (throw a typed rules error) when the match is over,
     when `by` is not the player whose turn it is, or when the column is full. Otherwise place the
     disc in the lowest empty row, check for a win in the four directions through the placed disc,
     check for a draw (board full), flip `turn`, increment `turnNo`, set `turnStartedAt = now`.
     Must not mutate the input state — return a new object.
   - `view(state, forPlayer)`: Connect 4 has no hidden information, so the view is the board plus
     `{ you: 0 | 1 | "spectator", yourTurn: boolean, turnNo, lastMove, winner, draw, deadline }`.
     Implement it as a real projection anyway (§5 rule 2) — never `return state`.
   - `waitingOn(state)`: `[]` when won or drawn, else `[players[turn]]`.
   - `deadline(state)`: `turnStartedAt + TURN_TIMEOUT_MS`, with `TURN_TIMEOUT_MS = 24 * 60 * 60 *
     1000` (24 h — PLAN.md §5 "a chess turn auto-passes after 24h"). Exported as a named constant.
   - `onDeadline(state, now)`: the auto-move. Play a deterministic legal column chosen via the
     seeded PRNG (not `Math.random()`), recording it as a timeout move. **Idempotent:** capture
     `turnNo` at entry and no-op if the turn has already advanced past the turn the deadline was for.
   - `result(state)`: `{ kind: "win", winners: [id] }`, `{ kind: "draw" }`, or `null`.
2. `games/connect4/ui.tsx` — the board:
   - Default-export a component taking `GameUiProps`. 7 clickable columns; clicking column `c` calls
     `send({ t: "drop", col: c })`. Disable input when it is not your turn, when the column is full,
     or when the match is done.
   - Show both players' nicknames with their colours, highlight the last move, and render the
     win/draw outcome. Show the turn deadline only through plan 05's `TurnIndicator` — do not
     duplicate the countdown here.
   - Keyboard accessible (columns reachable by tab, activated by Enter/Space) and legible at 360 px.
   - Colour must not be the only signal for whose disc is whose (add a shape/letter or an aria-label)
     — one coworker in the office will be colour-blind.
3. `games/registry.ts` — add the two one-line registrations: `connect4: connect4Game` in
   `serverGames`, and `connect4: () => import("./connect4/ui")` in `gameUi`. This should be the
   entire integration surface (§12 step 7); if it is not, fix the registry rather than special-casing
   Connect 4 elsewhere.
4. `games/connect4/game.test.ts` — vitest, pure:
   - a dropped disc lands in the lowest empty row; a full column is rejected;
   - horizontal, vertical and both diagonal wins are detected; a near-miss is not;
   - a full board with no line is a draw and `waitingOn` is `[]`;
   - out-of-turn actions are rejected and leave the state unchanged;
   - `reduce` does not mutate its input (deep-freeze the input state and assert no throw);
   - `init` with the same seed twice yields identical states (determinism);
   - `onDeadline` applied twice resolves exactly one turn (idempotence);
   - `view()` never returns the state object itself.
5. `web/routes/Dashboard.tsx` — no change should be needed (the create form is driven by
   `GAME_CATALOG`). Verify that Connect 4 now appears with its 2–2 player bounds; fix the form only
   if it hardcoded anything.

## Acceptance criteria

- [ ] `npm run typecheck`, `npm test`, `npm run build` pass, with the new Connect 4 tests green.
- [ ] Connect 4 is registered with exactly one line in each of `serverGames` and `gameUi`; no other
      file outside `games/connect4/` mentions `connect4`.
- [ ] `games/connect4/game.ts` imports nothing from `web/` or React and contains no `Math.random()`,
      no `Date.now()` inside `reduce` (time arrives as the `now` parameter).
- [ ] `reduce` is pure: it returns new state and never mutates its input (test-enforced).
- [ ] `view()` is a real per-player projection, not the raw state.
- [ ] `waitingOn` returns exactly one player while the game is live and `[]` once `result()` is
      non-null.
- [ ] `deadline()` returns a 24 h turn timeout and `onDeadline` auto-plays idempotently.
- [ ] The client UI sends only `{ t: "drop", col }` intents; the board is never sent to the server.
- [ ] After a game ends, the match shows under "Finished" on both dashboards and the DO's alarm is
      cleared.
- [ ] Board is usable by keyboard and at 360 px; disc ownership is distinguishable without colour.

## Verification

```bash
cd /home/stefano/workspace/party-dev
npm run typecheck && npm test && npm run build
npm run db:migrate:local
npm run dev
```

Two browser profiles (Alice and Bob):

1. Alice creates a Connect 4 match; Bob joins by code; Alice starts it.
2. Whoever the seed chose moves first — the other player's board is disabled and their dashboard
   shows the match under "Waiting on others"; the mover's dashboard shows it under **Your turn**.
3. Alternate moves. Each move appears in the other window within a second (WS), the turn indicator
   flips, and the history panel gains an entry.
4. Bob clicks a column while it is Alice's turn: rejected with a visible message, no state change,
   and the board in Alice's window is untouched.
5. Reload Bob's tab mid-game: the board is restored from the HTTP snapshot and the socket resyncs by
   `since` with no duplicate history.
6. Play to a win: both windows show the result, both dashboards move the match to **Finished**, and
   further drops are rejected.
7. Force the deadline path: temporarily lower `TURN_TIMEOUT_MS` to ~20 s (scratch edit, reverted
   before commit), start a match, let a turn expire, and confirm exactly one auto-move lands, the
   turn passes, and a `deadline_resolved` event appears once.

## Risks / notes

- The auto-move on a 24 h timeout is the §5 "game never wedges" guarantee, not a feature anyone will
  like. Keep it deterministic and visibly labelled as a timeout in the event log so players can see
  what happened.
- Watch the exact-2-player constraint: `init` must fail loudly if the lobby somehow starts with a
  different count (plan 04's start route checks `meta.minPlayers`/`maxPlayers`, but the module must
  not assume it).
- Do not add a rematch button here; it needs match-chaining semantics that no plan covers.
- If `reduce` needs to signal a rules violation, use the typed error mechanism plan 04 established
  for the `error` message path — do not return the unchanged state silently, or the client cannot
  tell a rejected move from a lost packet.
