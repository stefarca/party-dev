---
plan: 02-identity-and-match-api
goal: Implement PLAN.md — async turn-based party games on Cloudflare (Worker + Static Assets + Hono + Durable Objects with SQLite + D1 index + Slack nudges)
status: pending
depends_on: [01-scaffolding-and-plumbing]
---

# Identity (signed cookie) + match create/join/list API

## Objective

Add server-side identity — nickname plus an HMAC-signed cookie (PLAN.md §10.7) — and the match
lifecycle API: create a match with a joinable code, join by code, and list the caller's matches out
of the D1 index (PLAN.md §6). `MatchDO` gains a persisted lobby record (players, status) but still
has no game rules, no WebSocket, and no alarms.

Out of scope: all UI (plan 03), WebSockets / event log / engine / alarms (plan 04), starting a match
or playing it (plan 04+), Slack nudges (plan 08).

## Context

- Layout and conventions come from plan 01: Hono app in `worker/index.ts` typed
  `Hono<{ Bindings: Env }>`, `MatchDO` in `worker/match.ts` with a `meta (key, value)` SQLite table
  created in the constructor, D1 schema in `migrations/0001_init.sql`, `Env` generated into
  `worker-configuration.d.ts` by `npm run cf-typegen`.
- **PLAN.md §10.7 is binding:** no passwords. Nickname + HMAC-signed cookie via Web Crypto, key in a
  Worker secret. **PLAN.md §5 rule 1 is binding:** validate every inbound payload with zod —
  including these REST bodies, not just WS messages.
- **PLAN.md §6 is binding** for the D1 tables; this plan adds two columns to it (see step 6) and the
  reason must be stated in a SQL comment.
- `matchId === code` (assumption 4 in plan 01): the DO is `env.MATCH.idFromName(matchId)`.
- D1 is **derived** state (§6). The DO is authoritative; on disagreement the DO wins. All D1 index
  writes in this plan happen **from inside the DO**, which has its own `env.DB` binding — never
  write the index from the Worker, or the two sources can drift.

## Steps

1. `shared/protocol.ts` — the single home for cross-boundary types and zod schemas (§9). In this
   plan add: `PlayerId` (string), `MatchStatus` (`"lobby" | "active" | "done"`), `PlayerInfo`
   (`{ id, nickname }`), `MatchSummary` (`{ id, gameId, status, players: PlayerInfo[], waiting:
   boolean, updatedAt, deadline: number | null }`), and zod schemas for the request bodies:
   `IdentityRequest` (`{ nickname: string }`, trimmed, 1–24 chars, no control characters),
   `CreateMatchRequest` (`{ gameId: string }`), `JoinMatchRequest` (empty / none).
   Export inferred TS types alongside each schema.
2. `shared/ids.ts` — `generateMatchCode(random?: () => number): string`: 6 characters from the
   unambiguous alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no I, O, 0, 1). Also
   `normalizeMatchCode(raw: string): string` (uppercase, strip whitespace and dashes) and a
   `MATCH_CODE_RE` used by zod. Pure and unit-testable.
3. `games/catalog.ts` — `GameMeta = { id, name, minPlayers, maxPlayers }` and
   `GAME_CATALOG: GameMeta[]`, hardcoded for now with `connect4` (2–2) and `trivia` (2–8), plus
   `getGameMeta(id)`. **Plan 04 replaces the body of this file so the catalog is derived from the
   game registry while keeping these exact export names** — so keep the module's public surface to
   exactly `GameMeta`, `GAME_CATALOG`, `getGameMeta`.
4. `worker/auth.ts` — cookie identity:
   - `sign(payload: string, secret: string)` / `verify(...)` using Web Crypto
     `crypto.subtle.importKey("raw", ..., { name: "HMAC", hash: "SHA-256" }, ...)` and
     `crypto.subtle.sign` / `verify`. Compare with `crypto.subtle.verify`, not string equality.
   - Cookie name `party_session`, value `<base64url(JSON{ pid, nick, iat })>.<base64url(sig)>`.
     Attributes: `HttpOnly; Path=/; SameSite=Lax; Max-Age=31536000` and `Secure` when the request
     URL is https (so local http dev still works).
   - `readSession(c): Session | null` and `writeSession(c, session)`.
   - `playerId` is `crypto.randomUUID()`, minted once and preserved across nickname changes.
   - Secret: `env.SESSION_SECRET`. Add it to a gitignored `.dev.vars` and commit a
     `.dev.vars.example` with a dummy value; re-run `npm run cf-typegen` so `Env` includes it.
     If the secret is missing, fail closed with a 500 naming the missing binding — never fall back
     to an unsigned or constant key.
   - Add a Hono middleware that parses the session and puts it on the context
     (`c.set("session", ...)`), plus a `requireSession` guard returning 401 `{ error: "no_identity" }`.
5. `worker/api.ts` (or keep routes in `worker/index.ts` if it stays under ~150 lines) — endpoints,
   all under `/api`, all JSON, all zod-validated:
   - `POST /api/identity` `{ nickname }` → mints a session if none exists, updates the nickname if
     one does, sets the cookie, returns `{ playerId, nickname }`.
   - `GET /api/me` → `{ playerId, nickname }` or 401.
   - `POST /api/matches` `{ gameId }` (auth required) → validates `gameId` against `GAME_CATALOG`,
     generates a code, guards against collision by `INSERT` into D1 `matches` and retrying on
     constraint failure (cap at 5 attempts), then calls the DO's `POST /lobby/create` with
     `{ matchId, gameId, host: { id, nickname } }`. Returns `{ matchId, code }`. The DO is what
     writes the final index row; the Worker's insert is only the collision reservation — document
     this in a comment.
   - `POST /api/matches/:code/join` (auth required) → normalize the code, 404 if no D1 row, then
     forward to the DO's `POST /lobby/join` with `{ id, nickname }`. Returns the `MatchSummary`.
     Idempotent: re-joining as an existing player succeeds and is not an error.
   - `GET /api/matches` (auth required) → one D1 query joining `matches` and `match_players` for
     this `player_id`, returning `{ yourTurn: MatchSummary[], waiting: MatchSummary[], finished:
     MatchSummary[] }` — the three buckets from PLAN.md §6. Order by `updated_at DESC`; cap each
     bucket at 50.
   - `GET /api/games` → `GAME_CATALOG` (the client needs it to render a create form).
6. `migrations/0002_match_index_columns.sql` — extend PLAN.md §6's schema with, and only with:
   `ALTER TABLE matches ADD COLUMN host_id TEXT;` and
   `ALTER TABLE match_players ADD COLUMN nickname TEXT;`. Add a SQL comment explaining why
   (the dashboard must render opponents' names and the host badge from a single index query, and
   D1 is display-only derived state). Do not edit `0001_init.sql`.
7. `worker/match.ts` — give `MatchDO` a persisted lobby record:
   - `MatchRecord` type (define in `worker/match.ts`, not `shared/`, since it is server-internal):
     `{ id, gameId, status, hostId, players: { id, nickname, joinedAt }[], createdAt, updatedAt,
     seed: number, state: unknown | null }`. `seed` is `Math.floor(Math.random() * 2**31)` chosen
     **once at create time** and stored — never re-rolled (PLAN.md §5 rule 3; the seeded PRNG lives
     in state, so the seed must be stable and persisted).
   - Load/save helpers over the `meta` table: `readMatch(): MatchRecord | null`,
     `writeMatch(rec)` (JSON in `meta` under key `match`). Persist on every mutation; rehydrate by
     reading, never by caching across requests (hibernation wipes memory — §10.3).
   - Internal routes: `POST /lobby/create`, `POST /lobby/join`, `GET /snapshot?playerId=`.
     `join` enforces `maxPlayers` from `GAME_CATALOG` and rejects joins when `status !== "lobby"`
     with a 409.
   - After any mutation, call a new private `syncIndex()` that upserts the `matches` row and the
     `match_players` rows in D1 via `env.DB.batch(...)`. With no engine yet, `waiting` is 0 for
     everyone and `deadline` is null. Wrap the D1 write so a failure logs and does not fail the
     move — the DO is authoritative and the index can be repaired (§6).
8. Tests (`vitest`, node env, pure modules only):
   - `shared/ids.test.ts` — code alphabet, length, `normalizeMatchCode` round trip, deterministic
     output for a stubbed `random`.
   - `shared/protocol.test.ts` — nickname validation accepts/rejects the edge cases (empty, 25
     chars, whitespace-only, control chars).
9. `README.md` — add `SESSION_SECRET` to the operator deploy checklist
   (`wrangler secret put SESSION_SECRET`) and to the local setup section (copy `.dev.vars.example`
   to `.dev.vars`).

## Acceptance criteria

- [ ] `npm run typecheck`, `npm test`, `npm run build` pass.
- [ ] The session cookie is HMAC-signed with `env.SESSION_SECRET`; tampering with the payload half
      of the cookie makes `GET /api/me` return 401, not a forged identity.
- [ ] Cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` on https.
- [ ] Every request body is parsed with a zod schema from `shared/protocol.ts`; invalid bodies get
      400 with a machine-readable `{ error }`, never a thrown stack.
- [ ] `POST /api/matches` returns a 6-char code from the unambiguous alphabet; the DO persists the
      match record and the D1 `matches` + `match_players` rows exist afterwards.
- [ ] `POST /api/matches/:code/join` is idempotent for an existing player and 409s when the lobby is
      full or already started; unknown codes 404.
- [ ] `GET /api/matches` returns the three buckets and issues one D1 query (not one per match).
- [ ] All D1 index writes originate inside `MatchDO`; `grep` shows no `env.DB` write outside
      `worker/match.ts` except the create-time code reservation, which is commented as such.
- [ ] `.dev.vars` is gitignored; `.dev.vars.example` is committed with a dummy value.

## Verification

```bash
cd /home/stefano/workspace/party-dev
npm run typecheck && npm test && npm run build
npm run db:migrate:local
npm run dev
# second shell (cookie jar exercises the real session):
curl -s -c /tmp/a.txt -X POST localhost:5173/api/identity -H 'content-type: application/json' -d '{"nickname":"alice"}'
curl -s -b /tmp/a.txt localhost:5173/api/me
CODE=$(curl -s -b /tmp/a.txt -X POST localhost:5173/api/matches -H 'content-type: application/json' -d '{"gameId":"connect4"}' | sed -E 's/.*"code":"([^"]+)".*/\1/')
curl -s -c /tmp/b.txt -X POST localhost:5173/api/identity -H 'content-type: application/json' -d '{"nickname":"bob"}'
curl -s -b /tmp/b.txt -X POST "localhost:5173/api/matches/$CODE/join"
curl -s -b /tmp/a.txt localhost:5173/api/matches      # alice sees the match with both players
curl -s -b /tmp/b.txt localhost:5173/api/matches      # bob sees the same match
curl -s localhost:5173/api/me                          # => 401, no cookie
curl -s -X POST localhost:5173/api/matches/ZZZZZZ/join # => 404
```

Passing looks like: both players appear in the match's `players` array from either session, and the
D1-backed list endpoint shows the match for both.

## Risks / notes

- **Hibernation wipes in-memory state (§10.3).** Do not cache `MatchRecord` in an instance field
  across requests in this plan; read from storage per request. (Plan 04 may introduce a guarded
  in-constructor rehydrate.)
- **Code collisions:** 32^6 is ample, but the reservation-insert-then-retry loop must not leave
  orphan rows if the DO create call subsequently fails — delete the reserved row on failure.
- Nickname changes update the session cookie and should update `match_players.nickname` lazily (on
  the player's next join/action), not by fanning out to every match. Note this in a comment;
  stale opponent names in old matches are acceptable.
- Keep `GAME_CATALOG` hardcoded here. Deriving it from real game modules is plan 04's job, and doing
  it early forces the engine contract to be invented in the wrong plan.
