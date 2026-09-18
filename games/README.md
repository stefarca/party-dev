# Adding a game

A new game is a folder under `games/<id>/` plus one line each in `games/registry.ts` (and,
optionally, one in `games/icons.ts`) — nothing else. Checklist, in order:

1. **`games/<id>/game.ts`** implements `GameModule<S, A>` from `shared/game.ts`: `id`, `meta`,
   `actionSchema`, `init`, `reduce`, `view`, `waitingOn`, `deadline`, `onDeadline`, `result`.
2. **Pick a phase type:**
   - **Sequential** — `waitingOn(state)` returns exactly one player at a time; see
     `games/connect4/game.ts`.
   - **Simultaneous + deadline** — `waitingOn(state)` returns everyone who has not yet acted this
     round, and `deadline(state)` is non-null whenever anyone is waiting; see
     `games/trivia/game.ts` (which also shows the "resolve on all-submitted OR on alarm, via one
     shared function" pattern, and a reveal sub-phase in between rounds).
3. **Four rules are binding for every game:**
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
   - **UI:** the shell mounts your component inside its own cabinet, so a game UI must not render
     its own outer card — render the board/round content only. Style with Tailwind utility classes
     and the shared palette tokens declared in `web/styles.css` — colours in particular should read
     a `var(--token)` (e.g. the `--seat-1`…`--seat-4` seat ramp, `--accent`, `--ok-fg`/`--ok-soft`)
     rather than a hardcoded literal. A physical board should sit on `--board-well` (with
     `--board-rim` for its frame and `--board-hole` for an empty slot): those three and the seat
     ramp are deliberately the same in both themes, so pieces stay vivid and legible on a light page
     too. For motion, `web/styles.css` already provides a staggerable `.party-pop` entrance (set
     `--pop-delay` inline) and the `party-disc-drop`, `party-choice-press` and `party-celebrate`
     keyframes. `games/**/*.tsx` may import components from `@heroui/react` (the worker's
     `tsconfig.worker.json` parses these files without DOM types but with `skipLibCheck`, so
     HeroUI's own `.d.ts` type-checks fine — verify with `npm run typecheck` if you add a new import
     from there). A game UI must never import a `.css` file — `tsconfig.client.json` has no ambient
     module declaration for `*.css` — so any rule that cannot be expressed as a utility class (a
     `@keyframes` a Tailwind arbitrary-value animation refers to, for instance) belongs in
     `web/styles.css` instead. Never render the deadline or a countdown; the shell shows it once.
     Colour must never be the only signal for game state — pair it with text, a glyph, or an aria
     attribute. Tailwind only emits classes it can see statically, so never build a class name from
     a runtime value (e.g. `` `bg-seat-${n}` ``) — use a static lookup table of complete class
     strings, or set a CSS custom property inline instead.
5. **Register it** — one line in each map in `games/registry.ts`:
   - `serverGames`: `<id>: yourGame` (statically imported — the Worker bundle must contain every
     game's rules with no network round-trip).
   - `gameUi`: `<id>: () => import("./<id>/ui")` (dynamically imported — keeps the client bundle
     from growing with every game that isn't the one currently open).
6. **Optional: `games/<id>/icon.tsx`** default-exports the icon on the game's tile — the contents
   of a 24×24 `<svg>` (no `<svg>` element of its own), drawn in `currentColor` over the tile's
   gradient; keep it to a few bold shapes, since it renders at about 30px. Register it with one line
   in `gameIcons` in `games/icons.ts`, not in `games/registry.ts`: the Worker imports the registry,
   and an icon is a `.tsx` module. A game without an icon gets an abstract motif picked by hashing
   its id.
7. **`games/<id>/game.test.ts`** covers, at minimum:
   - purity (`reduce`/`onDeadline` do not mutate their input and return a new object),
   - determinism (`init`/`reduce` given the same seed/actions produce identical output),
   - `onDeadline` idempotence (running it twice on the same overdue state is a no-op the second
     time),
   - view leakage (`view(state, p)` never contains another player's hidden information or, once
     applicable, the correct answer/outcome before it should be visible).
8. **`games/<id>/ui.spec.ts`** plays the game in real browsers with Playwright
   (`npm run test:e2e`, or `npm run test:e2e:ui` to watch it while you work on `ui.tsx`). Import
   `test` and `expect` from `e2e/fixtures.ts`:
   - `const { players: [first, second] } = await startMatch("<id>")` signs in two players, then
     creates, starts and opens a match for both. `players[0]` is the player the game waits on
     first, since who opens is drawn at random.
   - Find the board's controls by role and accessible name (`page.getByRole("button", { name })`).
     These are the labels your UI already gives screen readers, so if a spec cannot find something
     by name, a screen-reader user cannot either.
   - After each move, wait for the mover's turn banner to go
     (`await expect(player.yourTurn).toBeHidden()`) before the other player acts. Otherwise a page
     that has not yet received its own move can move again.
   - Cover at least: the opening move reaching the other player's board and passing the turn, a
     finished game ("You won!" for the winner, "<name> won." for everyone else), and each rule the
     board enforces (a full column, a forced capture). `game.test.ts` proves the rules. The spec
     proves the board offers and shows them.

   `games/tictactoe/ui.spec.ts` is the shortest example.

That's it — `MatchDO` (`worker/match.ts`) never needs a game-specific change: `commit()`'s
persist/broadcast/D1-index/nudge pipeline, the WebSocket transport, and the dashboard all run
identically against any `GameModule`. See `games/connect4/` (sequential) and `games/trivia/`
(simultaneous + deadline) as complete reference implementations.
