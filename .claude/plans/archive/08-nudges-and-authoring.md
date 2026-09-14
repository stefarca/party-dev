---
plan: 08-nudges-and-authoring
goal: Implement PLAN.md — async turn-based party games on Cloudflare (Worker + Static Assets + Hono + Durable Objects with SQLite + D1 index + Slack nudges)
status: done
depends_on: [06-connect4-sequential, 07-trivia-simultaneous]
---

# Slack nudges, tab-title badge, and the "add a game" authoring path

## Objective

Close PLAN.md §8 and §12 steps 6–7: send a Slack incoming-webhook nudge to players who are newly
waited-on and not currently connected, rate-limited to one nudge per player per match per turn; add
the tab title / favicon badge for open tabs; and document the registry-based authoring path so game
#3 is a folder plus one registry line.

Out of scope: Web Push and service workers (PLAN.md §8 item 3 — explicitly "later, not v1"), Slack
slash commands or interactive message actions, per-user Slack DM mapping, email, and any new game.

## Context

- Plan 04 left the final pipeline stage as a stub: `private async nudgeHook(rec, newlyWaiting)` in
  `worker/match.ts`, called last in `commit()` with `newlyWaiting` = `waitingOn` minus the previous
  `waitingOn`. **This plan fills in that method and changes nothing else about the pipeline order**
  (§5: `... -> update D1 index -> nudge newly-waited-on players who are not connected`).
- Plan 04 also left `isConnected(playerId)` over `ctx.getWebSockets()` + `deserializeAttachment()`.
  "Not connected" means exactly that: no live hibernatable socket for that player id.
- **§8 rate limit is binding:** one nudge per player per match per turn, tracked via `nudged_at`.
  Nothing burns goodwill faster than a bot pinging the channel every 30 seconds.
- The Slack webhook URL is a secret, never a committed value and never exposed to the client.
- Connect 4 nudges one player per move; trivia nudges everyone at the start of a round. Both must be
  exercised in verification.

## Steps

1. `worker/nudge.ts` — `sendSlackNudge(env, { matchId, gameName, players, url, kind })`:
   - One `fetch(env.SLACK_WEBHOOK_URL, { method: "POST", body: JSON.stringify({ text }) })` (§8: "one
     `fetch()` to a secret URL, ~10 lines"). Use Slack's simple `text` payload; no Block Kit.
   - Message shape: who is being waited on, which game, and a link to `<PUBLIC_BASE_URL>/m/<code>`.
     Batch a single message when several players become waited-on at once (a trivia round start must
     be **one** message, not N).
   - No-op cleanly (log once, return) when `SLACK_WEBHOOK_URL` is unset — local dev and any
     contributor without the secret must still work.
   - Never throw out of this function; a Slack outage must not fail a move or, worse, cause an alarm
     retry storm (§10.6).
2. `wrangler.jsonc` — add `"vars": { "PUBLIC_BASE_URL": "http://localhost:5173" }` and document that
   production overrides it. `SLACK_WEBHOOK_URL` stays a secret: add it to `.dev.vars.example` with a
   dummy value and to the README operator checklist (`wrangler secret put SLACK_WEBHOOK_URL`). Re-run
   `npm run cf-typegen` so `Env` includes both.
3. `worker/match.ts` — implement `nudgeHook`:
   - Filter `newlyWaiting` to players where `!isConnected(playerId)`.
   - Apply the §8 rate limit: keep `nudgedAt: Record<PlayerId, number>` on the persisted
     `MatchRecord`; a player is eligible only if they have not been nudged since they most recently
     *became* waited-on. Clear a player's entry as soon as they stop being waited on, so the next
     turn can nudge again. Also enforce a hard floor (no more than one nudge per player per match per
     `MIN_NUDGE_INTERVAL_MS`, default 10 minutes) as a backstop against a pathological game.
   - Fire via `this.ctx.waitUntil(sendSlackNudge(...))` so the move's response is not blocked; the
     nudge is best-effort.
   - Persist the updated `nudgedAt` as part of the same record write, not a second write.
   - **Deviation from §8, to be noted in a comment:** §8 says track `nudged_at` "on the match row",
     which reads as D1. It lives in the DO record instead because the DO is authoritative and this
     avoids a read-modify-write against derived state on every move (§6). No D1 migration is needed.
4. `worker/match.ts` — also nudge on a `deadline_resolved` transition that creates new waiters (the
   trivia next-round case). This falls out of `commit()` naturally if the alarm path funnels through
   it, as plan 04 requires; verify rather than assume, and add a test-visible comment if not.
5. `web/badge.ts` + wiring in `web/App.tsx` — §8 item 2, the tab badge:
   - Maintain `document.title` as `(n) Party` where `n` is the size of the dashboard's "your turn"
     bucket; drop the prefix when `n === 0`.
   - Update it from the dashboard fetch and from any `useMatch` snapshot where the local player
     becomes waited-on.
   - Favicon badge: draw a small canvas (base glyph + a dot with the count) and swap the
     `<link rel="icon">` href; skip silently if canvas is unavailable. Ship a static
     `web/public/favicon.svg` (or equivalent per the Vite setup) as the base.
   - Restore the plain title when the tab regains focus and the count is zero.
6. `games/README.md` — §12 step 7, the authoring checklist:
   - create `games/<id>/game.ts` implementing `GameModule` from `shared/game.ts`;
   - pick a phase type (§4) — sequential (`waitingOn` = one player) or simultaneous + deadline
     (`waitingOn` = everyone outstanding, `deadline` always non-null) — and point at Connect 4 and
     trivia as the reference implementations;
   - the four §5 rules (server-authoritative intents, mandatory `view()`, seeded PRNG in state,
     idempotent `onDeadline`);
   - create `games/<id>/ui.tsx` default-exporting a `GameUiProps` component;
   - add one line to each map in `games/registry.ts`;
   - add `games/<id>/game.test.ts` covering purity, determinism, `onDeadline` idempotence and view
     leakage.
   Keep it to one screen; it is a checklist, not an essay.
7. `README.md` — final pass: the Slack secret and `PUBLIC_BASE_URL` in the operator checklist, a
   pointer to `games/README.md`, and a short "what works today" summary (identity, dashboard,
   Connect 4, trivia, nudges).
8. Tests — `worker/nudge.test.ts` over the pure parts only: message composition (single vs. batched
   players, correct match URL) and the rate-limit predicate extracted as a pure function
   (`shouldNudge(nudgedAt, playerId, now, becameWaitingAt)`), so it is testable without a DO.

## Acceptance criteria

- [ ] `npm run typecheck`, `npm test`, `npm run build` pass.
- [ ] With `SLACK_WEBHOOK_URL` unset, everything works and no nudge is attempted (one log line at
      most); with it set, a nudge fires for a newly-waited-on, disconnected player.
- [ ] A connected player (open socket) is never nudged.
- [ ] Exactly one nudge per player per turn: repeated commits that do not change `waitingOn` produce
      no further messages, and several players becoming waited-on at once produce **one** batched
      Slack message.
- [ ] `nudgedAt` is cleared when a player stops being waited on, so the following turn can nudge.
- [ ] The nudge runs last in the pipeline, via `ctx.waitUntil`, and a Slack failure never fails the
      move or escapes `alarm()`.
- [ ] `SLACK_WEBHOOK_URL` appears in no committed file except `.dev.vars.example` (dummy) and the
      README instructions; `grep -r "hooks.slack.com" .` finds nothing real.
- [ ] Tab title shows `(n) Party` while matches await the player and reverts to `Party` at zero.
- [ ] `games/README.md` exists and matches the actual registry API, verified by following it
      mentally against `games/connect4/`.
- [ ] No Web Push, no service worker, no new runtime dependency.

## Verification

```bash
cd /home/stefano/workspace/party-dev
npm run typecheck && npm test && npm run build
npm run db:migrate:local
```

Set up a throwaway webhook receiver for local testing (no Slack account needed): point
`SLACK_WEBHOOK_URL` in `.dev.vars` at any request-capturing endpoint you control, or temporarily at
`http://localhost:9999/hook` with a one-line node listener that logs the body. Then `npm run dev`.

1. **Sequential nudge:** Alice and Bob start a Connect 4 match. Bob closes his tab entirely. Alice
   moves → exactly one webhook POST naming Bob, with a `/m/<CODE>` link. Alice cannot move again, so
   commit something else (e.g. reload her page): **no** second POST.
2. **No nudge when connected:** Bob reopens and stays on the match page; Alice moves → no POST.
3. **Batched nudge:** three profiles start a trivia match, all three close their tabs, then advance
   the round via the alarm (lower `ROUND_TIMEOUT_MS` with a scratch edit, reverted before commit) →
   exactly one POST listing the outstanding players, not three.
4. **Alarm path:** while every tab is closed, the trivia reveal alarm advances the round and produces
   a nudge; confirm it arrives once even if the alarm is retried.
5. **Secret absent:** unset `SLACK_WEBHOOK_URL`, repeat step 1 → no POST, no error, gameplay normal.
6. **Badge:** with a tab open on the dashboard, make it the player's turn from another profile →
   title becomes `(1) Party` and the favicon shows a dot; take the turn → back to `Party`.
7. Re-run `npm test`.

## Risks / notes

- **Rate limiting is the whole risk surface.** A bug here spams a real office channel. Verify step 1
  and step 3 carefully, and prefer nudging too little over too much.
- `ctx.waitUntil` inside a DO keeps the object alive until the fetch settles; a hung Slack request
  could hold it briefly. Set an `AbortSignal.timeout(5000)` on the fetch.
- Slack rate-limits incoming webhooks (roughly 1 message/second sustained per hook). The 10-minute
  per-player floor plus batching keeps this far away, but do not remove the batching to simplify.
- `PUBLIC_BASE_URL` defaulting to localhost means production nudges link to localhost until the
  operator overrides the var — call this out explicitly in the README checklist.
- The favicon canvas dance is cosmetic; if it fights the Vite asset pipeline, ship the title badge
  alone and note the omission rather than sinking time into it.
