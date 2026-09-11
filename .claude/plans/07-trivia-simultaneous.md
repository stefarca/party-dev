---
plan: 07-trivia-simultaneous
goal: Implement PLAN.md — async turn-based party games on Cloudflare (Worker + Static Assets + Hono + Durable Objects with SQLite + D1 index + Slack nudges)
status: pending
depends_on: [04-engine-core, 05-client-match-transport, 06-connect4-sequential]
---

# Trivia rounds — the simultaneous + deadline phase type, end to end

## Objective

Ship the second reference game: a multi-round trivia game as `games/trivia/{game.ts, ui.tsx,
questions.ts}`, registered with one line in `games/registry.ts`. Its purpose (PLAN.md §12 step 5) is
to prove the **simultaneous + deadline** phase type from §4: everyone answers at once, the round
advances when all have submitted **or** when the alarm fires, non-answerers score zero, and hidden
information (other players' answers, the correct answer) never leaks before resolution.

Out of scope: Slack nudges (plan 08), a question-authoring UI, importing an external question bank,
per-question timers that differ from the round deadline, any change to Connect 4.

## Context

- Contract, PRNG and registry all come from plan 04 (`shared/game.ts`, `shared/prng.ts`,
  `games/registry.ts`, `games/catalog.ts`). Plan 06's `games/connect4/` is the worked example of the
  file layout and test style — follow it.
- **This game is the reason `view()` exists (§5 rule 2).** Full state contains the correct answer and
  everyone's submissions; a broadcast of raw state would hand players the answer key in devtools.
- **This game is the reason `onDeadline` must be idempotent (§5 rule 4, §10.6).** Alarms are
  at-least-once with up to 6 retries on throw; a double-resolve would score a round twice. Key the
  guard on the round number.
- Plan 04's pipeline sets the DO alarm from `deadline(state)` on every commit, and plan 05's
  `TurnIndicator` already renders a countdown from `snapshot.deadline` — do not re-implement either.
- §2: outgoing WS messages are free, inbound is billed 20:1 — so per-player tailored views are fine,
  but do not add client-side polling or chatty progress pings.

## Steps

1. `games/trivia/questions.ts` — a small static bank (20–30 questions) as
   `{ id: string; q: string; choices: string[]; answer: number }[]`, office-appropriate and
   non-controversial. Plain data, no imports. Export `QUESTIONS` and the count.
2. `games/trivia/game.ts`:
   - `type TriviaState = { players: PlayerId[]; questionIds: string[]; round: number;
     roundStartedAt: number; answers: Record<PlayerId, number>; /* current round only */
     revealed: { questionId: string; answer: number; given: Record<PlayerId, number | null> } | null;
     scores: Record<PlayerId, number>; phase: "answering" | "reveal" | "done"; rng: number }`.
   - `init(players, seed)`: use `shuffle` from `shared/prng.ts` with `seed` to pick and order
     `ROUNDS` questions (default 5, exported constant), store the advanced rng value, set
     `round = 0`, `phase = "answering"`, zeroed scores. No `Math.random()`.
   - `actionSchema`: `z.object({ t: z.literal("answer"), round: z.number().int(), choice:
     z.number().int().min(0) })` — including `round` so a late answer for a resolved round is
     rejected rather than misapplied.
   - `reduce(state, action, by, now)`: reject when `phase !== "answering"`, when `action.round !==
     state.round`, when `by` already answered this round, when the choice index is out of range for
     the current question. Otherwise record the answer; **if every player has now answered, resolve
     the round immediately** (same resolution function that `onDeadline` uses). Pure; no mutation.
   - A single shared private `resolveRound(state, now)` used by both `reduce` (all-submitted) and
     `onDeadline` (timeout) so the two paths cannot diverge: score +1 for each correct answer, 0 for
     wrong and 0 for non-answerers, populate `revealed`, then advance to the next round (or
     `phase = "done"` after the last one). Include a short reveal window (`REVEAL_MS`, ~8 s) during
     which `phase = "reveal"` and the next question is not yet accepting answers; the alarm then
     moves the game on. Keep the reveal window optional-but-implemented: it is what makes the
     deadline machinery visibly work twice per round.
   - `view(state, forPlayer)`: during `answering`, return the current question text and choices,
     **your own** submitted choice (if any), the *count* of players who have answered (never who
     answered what, never the correct index), the scoreboard, `round`, `totalRounds` and the
     deadline. During `reveal`, return the correct answer and everyone's answers. During `done`,
     return the final scoreboard.
   - `waitingOn(state)`: during `answering`, everyone who has not answered this round; during
     `reveal`, `[]` (nobody is blocked — the alarm advances it); when done, `[]`.
   - `deadline(state)`: `roundStartedAt + ROUND_TIMEOUT_MS` while answering (exported constant,
     default 24 h so the game survives a meeting — §5), reveal-start + `REVEAL_MS` while revealing,
     `null` when done.
   - `onDeadline(state, now)`: if `phase === "answering"` → `resolveRound`; if `phase === "reveal"`
     → advance to the next round / finish. **Idempotence:** no-op if the state's round/phase has
     already moved past what the alarm was scheduled for.
   - `result(state)`: `null` until `phase === "done"`, then `{ kind: "scores", scores }` (and the
     winner set if your `Result` type expresses ties — follow plan 04's type, do not extend it).
3. `games/trivia/ui.tsx` — default-export a `GameUiProps` component:
   - Answering: the question, the choices as large tap targets, your selection highlighted and
     locked after submit (`send({ t: "answer", round, choice })`), a "3 of 4 answered" progress line
     from the view's count, the scoreboard, and round `n/N`. The countdown comes from plan 05's
     `TurnIndicator`.
   - Reveal: correct answer marked, each player's pick shown, score deltas.
   - Done: the final scoreboard with the winner highlighted.
   - Accessible (radio-group semantics or buttons with `aria-pressed`), legible at 360 px, and never
     rendering anything not present in `view` (no client-side answer key).
4. `games/registry.ts` — one line in `serverGames` (`trivia: triviaGame`) and one in `gameUi`
   (`trivia: () => import("./trivia/ui")`).
5. `games/trivia/game.test.ts` — vitest, pure:
   - all players answering resolves the round without any alarm involvement;
   - `onDeadline` while answering scores non-answerers 0 and resolves exactly once;
   - **applying `onDeadline` twice to the same state is a no-op the second time** (the §5 rule 4
     proof);
   - a late answer carrying a stale `round` is rejected;
   - a second answer from the same player in the same round is rejected;
   - `view()` during `answering` contains neither the correct answer index nor any other player's
     choice — assert on the serialized JSON, not just on the typed fields;
   - identical seeds produce identical question orders (determinism);
   - `waitingOn` shrinks as answers arrive and is `[]` when done;
   - a full playthrough of `ROUNDS` rounds ends with `result()` non-null and scores summing
     correctly.
6. `README.md` — one line in the game list noting Connect 4 (sequential) and trivia (simultaneous)
   as the two reference implementations of §4's phase types.

## Acceptance criteria

- [ ] `npm run typecheck`, `npm test`, `npm run build` pass with the new tests green.
- [ ] Trivia is registered with exactly one line in each registry map; nothing outside
      `games/trivia/` mentions `trivia`.
- [ ] Round resolution is implemented once and shared by the all-answered path and the timeout path.
- [ ] `onDeadline` is idempotent under repeated application (test-enforced) — no double scoring.
- [ ] `view()` leaks neither the correct answer nor other players' choices during `answering`
      (test-enforced against the serialized view).
- [ ] `waitingOn` lists every player who has not yet answered the current round.
- [ ] `deadline()` is non-null during both `answering` and `reveal`, and `null` when the match is
      done; the DO alarm is cleared at the end.
- [ ] No `Math.random()`, no `Date.now()` inside the reducer; `game.ts` imports no React.
- [ ] Connect 4 is untouched by this diff.

## Verification

```bash
cd /home/stefano/workspace/party-dev
npm run typecheck && npm test && npm run build
npm run db:migrate:local
npm run dev
```

Three browser profiles if possible (Alice, Bob, Carol), otherwise two:

1. Alice creates a trivia match; the others join by code; Alice starts it.
2. All windows show round 1 simultaneously and all three dashboards show the match under **Your
   turn** (this is the observable difference from Connect 4 — many players waited on at once).
3. Alice answers: her UI locks, the progress line updates in every window, and her dashboard moves
   the match to "Waiting on others" while the others stay in "Your turn".
4. The remaining players answer: the round resolves immediately without waiting for the deadline,
   the reveal shows the correct answer and everyone's picks, and scores update.
5. After the reveal window elapses, the alarm advances to round 2 with no user action — including
   when **every** tab is closed: close all tabs during a reveal, wait past `REVEAL_MS`, reopen, and
   confirm the game advanced on its own.
6. Timeout path: with a scratch edit lowering `ROUND_TIMEOUT_MS` to ~20 s (reverted before commit),
   let one player not answer; the round resolves on the alarm, that player scores 0, and the
   `deadline_resolved` event appears exactly once in the history panel.
7. Play to the end: final scoreboard in every window, match under **Finished** on every dashboard.

## Risks / notes

- **The reveal phase introduces a second alarm per round.** Make sure `commit` reschedules rather
  than leaving a stale alarm (plan 04 reconciles with `getAlarm()`); a missed reschedule wedges the
  match in `reveal` forever — check this explicitly in verification step 5.
- The `waitingOn` set during `answering` is every unanswered player; plan 08 will nudge all of them.
  Keep the set accurate or the nudges get noisy.
- If the reveal window proves fiddly, it may be collapsed into an immediate advance — but then say so
  in the diff and keep at least one deadline-driven transition, since proving the alarm path is this
  plan's entire purpose.
- Question bank: keep it short and obviously placeholder-quality. Curating content is §12 step 7's
  job, not this plan's.
