# party-dev

A collection of small async, turn-based party games for playing with coworkers, hosted on
Cloudflare's free tier (Worker + Static Assets + Durable Objects + D1). See
[`PLAN.md`](./PLAN.md) for the full technical plan.

## Prerequisites

- Node.js (v22+; developed against v26) and npm.
- No Cloudflare account is required for local development — everything below runs against the
  real `workerd` runtime locally via `@cloudflare/vite-plugin` and a local D1 SQLite file.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # sets a dummy SESSION_SECRET for local identity cookies
npm run cf-typegen        # generates worker-configuration.d.ts (already committed; re-run if bindings change)
npm run db:migrate:local  # creates the local D1 sqlite file and applies migrations/000*.sql
npm run dev                # starts vite + workerd; prints the local URL
```

Local D1 and Durable Object storage both persist under `.wrangler/state`, which
`wrangler d1 migrations apply --local` and `@cloudflare/vite-plugin` share by default. If you ever
see `/api/health` report "no such table: matches", the two are pointing at different persist
directories — re-run `npm run db:migrate:local` or pass matching `--persist-to` / `persistState`
options.

Other useful scripts:

- `npm run typecheck` — `tsc -b --noEmit` across the worker/client/node project references.
- `npm test` — runs the Vitest suite (pure modules only; no Durable Object integration tests).
- `npm run build` — builds the client (`dist/client`) and the Worker bundle.
- `npm run preview` — serves the production build locally.

## Engine

Every game is a `GameModule` (`shared/game.ts`, PLAN.md §5) run inside `MatchDO`. After every
mutation — a player joining, the host starting, a submitted action, or an alarm firing —
`MatchDO.commit()` runs the same pipeline, in this order:

1. persist the new state (+ `updatedAt`) to the DO's own SQLite,
2. append the mutation's events to the append-only event log,
3. recompute `waitingOn(state)` and `deadline(state)`,
4. reconcile the DO alarm against that deadline (`setAlarm`/`deleteAlarm`),
5. broadcast a per-player `snapshot` (each socket's own `view(state, playerId)`, never raw state)
   plus any new events to every connected WebSocket,
6. update the D1 index (`matches`/`match_players` — derived, dashboard-only),
7. nudge newly-waited-on players who are not connected (a no-op stub until Slack nudges land).

Four rules every `GameModule` must follow (PLAN.md §5):

- **Server-authoritative.** Clients send intents (`action`), never state; every inbound message is
  zod-validated (including via the module's own `actionSchema`).
- **`view()` is mandatory, not optional.** Broadcasting full state leaks hidden information — project
  per player and send tailored messages.
- **Seeded PRNG in state, never `Math.random()` inside `reduce`.** Use `shared/prng.ts` and store the
  advanced seed in the game's own state.
- **`onDeadline` must be idempotent.** Alarms are at-least-once with retries; key resolution on the
  round/phase number so re-running it on an already-resolved round is a no-op.

A new game is a folder under `games/` plus one line each in `games/registry.ts`'s `serverGames`
(server rules) and `gameUi` (lazily-imported client UI) — nothing else.

Two reference implementations of PLAN.md §4's phase types live under `games/`: Connect 4
(`games/connect4`, sequential turns — plan 06) and Trivia (`games/trivia`, simultaneous answers +
deadline, with a reveal phase in between — plan 07).

## Deploying (operator, requires a Cloudflare account)

This repo's `wrangler.jsonc` commits a **placeholder** `d1_databases[0].database_id`
(`REPLACE_ME_SEE_README`) because creating a real D1 database requires an authenticated Cloudflare
account, which the implementer does not have. To deploy for real:

1. `wrangler login`
2. `wrangler d1 create party` — copy the `database_id` from the output.
3. Paste that `database_id` into `wrangler.jsonc` under `d1_databases[0].database_id`.
4. `npm run db:migrate:remote` — applies `migrations/*.sql` to the real D1 database.
5. `wrangler secret put SESSION_SECRET` — sets the HMAC key used to sign identity cookies
   (PLAN.md §10.7). Generate a long random value; never reuse the `.dev.vars` dummy.
6. `npm run deploy` — builds the client and runs `wrangler deploy`.

Do not commit the real `database_id` if you'd rather keep it private; it is not a secret, but the
`REPLACE_ME_SEE_README` placeholder in this repo intentionally does not point at anything.
