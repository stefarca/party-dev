# Adding a game

A new game is a folder under `games/<id>/` plus one line each in `games/registry.ts` — nothing
else. Checklist, in order:

1. **`games/<id>/game.ts`** implements `GameModule<S, A>` from `shared/game.ts`: `id`, `meta`,
   `actionSchema`, `init`, `reduce`, `view`, `waitingOn`, `deadline`, `onDeadline`, `result`.
2. **Pick a phase type** (PLAN.md §4):
   - **Sequential** — `waitingOn(state)` returns exactly one player at a time; see
     `games/connect4/game.ts`.
   - **Simultaneous + deadline** — `waitingOn(state)` returns everyone who has not yet acted this
     round, and `deadline(state)` is non-null whenever anyone is waiting; see
     `games/trivia/game.ts` (which also shows the "resolve on all-submitted OR on alarm, via one
     shared function" pattern, and a reveal sub-phase in between rounds).
3. **The four §5 rules are binding for every game:**
   - Server-authoritative: `reduce` and `onDeadline` are the only things that ever produce state;
     clients send `action`s (validated by your own `actionSchema`), never state.
   - `view(state, forPlayer)` is mandatory: return a per-player projection, never raw `state` — it
     is broadcast to that player's own socket and nobody else's. Any secret (an answer key, another
     player's hidden hand) that leaks through `view()` leaks to every player's devtools.
   - Seeded PRNG only: draw randomness from `shared/prng.ts` (`nextInt`, `shuffle`), threading the
     advanced seed back through `state`. Never call `Math.random()` inside `reduce`/`onDeadline`.
   - `onDeadline` must be idempotent: alarms are at-least-once with up to 6 retries on throw. Key
     resolution on the round/turn number already in `state` and no-op if it has already resolved —
     re-running it on an already-resolved round must return state that is unchanged in every
     observable way (same `deadline()`, same `result()`).
4. **`games/<id>/ui.tsx`** default-exports a component typed `GameUiProps` (`shared/protocol.ts`):
   render `view`, call `send(action)` for intents, and use the shared `TurnIndicator` (mounted by
   `MatchPage`, not by your UI) for the generic "whose turn / deadline" display — do not duplicate
   it.
5. **Register it** — one line in each map in `games/registry.ts`:
   - `serverGames`: `<id>: yourGame` (statically imported — the Worker bundle must contain every
     game's rules with no network round-trip).
   - `gameUi`: `<id>: () => import("./<id>/ui")` (dynamically imported — keeps the client bundle
     from growing with every game that isn't the one currently open).
6. **`games/<id>/game.test.ts`** covers, at minimum:
   - purity (`reduce`/`onDeadline` do not mutate their input and return a new object),
   - determinism (`init`/`reduce` given the same seed/actions produce identical output),
   - `onDeadline` idempotence (running it twice on the same overdue state is a no-op the second
     time),
   - view leakage (`view(state, p)` never contains another player's hidden information or, once
     applicable, the correct answer/outcome before it should be visible).

That's it — `MatchDO` (`worker/match.ts`) never needs a game-specific change: `commit()`'s
persist/broadcast/D1-index/nudge pipeline, the WebSocket transport, and the dashboard all run
identically against any `GameModule`. See `games/connect4/` (sequential) and `games/trivia/`
(simultaneous + deadline) as complete reference implementations.
