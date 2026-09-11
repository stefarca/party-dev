---
plan: 03-dashboard-spa
goal: Implement PLAN.md — async turn-based party games on Cloudflare (Worker + Static Assets + Hono + Durable Objects with SQLite + D1 index + Slack nudges)
status: pending
depends_on: [01-scaffolding-and-plumbing, 02-identity-and-match-api]
---

# The dashboard SPA: nickname, create/join, your-turn lists

## Objective

Build the client application shell on top of the plan 02 API: a nickname gate, the async dashboard
("your turn (n) / waiting on others / finished" — PLAN.md §6), a create-match form driven by
`/api/games`, a join-by-code form, and a lobby page for a single match showing its players and share
code. PLAN.md §12 step 2 calls this "*the* app" — it must be usable before any game exists.

Out of scope: WebSockets and live updates (plan 05), any game board or game UI (plans 06/07),
starting a match (plan 04 adds the engine; the lobby's Start button lands there), Slack nudges and
the tab-title badge (plan 08).

## Context

- Plan 01 left `web/main.tsx`, `web/App.tsx` (a throwaway `/api/health` dump) and `web/styles.css`,
  with `index.html` at the repo root loading `/web/main.tsx`. Replace `App.tsx` wholesale.
- Plan 02 exposes: `POST /api/identity`, `GET /api/me`, `GET /api/games`, `POST /api/matches`,
  `POST /api/matches/:code/join`, `GET /api/matches` (three buckets), and a
  `GET /api/matches/:id`-equivalent DO snapshot route. **Read `shared/protocol.ts` first** — reuse
  `MatchSummary`, `PlayerInfo`, `GameMeta`; do not redeclare client-side copies of these types.
- `assets.not_found_handling` is `single-page-application`, so any path serves `index.html` and
  client-side routing works on deep links and reloads.
- **No router dependency.** Adding `react-router` is out of scope; implement ~40 lines of
  `history.pushState` + `popstate` routing in `web/router.tsx`. Routes needed: `/` (dashboard),
  `/m/:code` (match/lobby page). Keep the route table in one place so plans 05–07 can extend it.
- Session identity is an HttpOnly cookie: every `fetch` must use `credentials: "same-origin"` and
  the client can never read the cookie — identity comes from `GET /api/me` only.

## Steps

1. `web/api.ts` — a thin typed client: `getMe`, `setIdentity(nickname)`, `getGames`,
   `listMatches`, `createMatch(gameId)`, `joinMatch(code)`, `getMatch(id)`. One shared
   `request()` helper that sets `credentials: "same-origin"`, JSON headers, throws a typed
   `ApiError { status, code, message }` on non-2xx, and surfaces 401 distinctly so the UI can send
   the user back to the nickname gate. Types imported from `shared/protocol.ts`.
2. `web/session.tsx` — a `SessionProvider` + `useSession()` context holding
   `{ state: "loading" | "anon" | "ready", player }`, calling `getMe()` once on mount and exposing
   `signIn(nickname)` and `rename(nickname)`.
3. `web/routes/NicknameGate.tsx` — shown when `state === "anon"`: one input, one button, inline
   validation matching the server's 1–24-char rule, error display on failure. On success the app
   re-renders into the dashboard. Must preserve the intended destination: if the user deep-linked to
   `/m/ABCDEF`, land them there after setting a nickname.
4. `web/routes/Dashboard.tsx`:
   - Three sections in this order: **Your turn** (with the count in the heading), **Waiting on
     others**, **Finished**. Empty states must say something useful, not render nothing.
   - Each row: game name (from `/api/games` meta, falling back to the raw `gameId`), the other
     players' nicknames, relative time from `updatedAt`, deadline if present, and a link to
     `/m/:id`.
   - A "Play again"/create panel: a `<select>` of `GAME_CATALOG` entries with min/max players shown,
     and a Create button → `createMatch` → navigate to `/m/:code`.
   - A join panel: a code input that runs the value through the same normalization as
     `normalizeMatchCode` in `shared/ids.ts` (import it — do not reimplement), then `joinMatch`.
   - Refresh on window `focus` and on a 30 s interval (`setTimeout` chain or `setInterval` in the
     browser is fine — the §10.4 ban on `setInterval` applies to Durable Objects only; say so in a
     comment so a reviewer doesn't flag it). Do not poll when the tab is hidden.
5. `web/routes/MatchPage.tsx` — for now, a **lobby** view: match code shown large with a
   copy-to-clipboard button and a shareable URL, the player list with the host marked, the game's
   name and player-count requirements, and a status line. If the match status is not `lobby`, render
   a placeholder "this match is in progress — gameplay lands in a later step" panel. **Leave a
   clearly marked seam** (a single component boundary, e.g. `<MatchBody match={...} />`) where plan
   05 will mount the live transport. Data comes from a plain `getMatch(id)` fetch on mount plus a
   manual Refresh button — no WebSocket in this plan.
6. `web/App.tsx` — compose: `SessionProvider` → router → (`NicknameGate` | route content), plus a
   header showing the current nickname with a rename affordance and a link home.
7. `web/styles.css` — extend into a small hand-written stylesheet: layout container, cards for match
   rows, buttons, inputs, a `your-turn` accent. Mobile-first and legible at 360 px wide; people will
   check this on their phone between meetings. No CSS framework, no component library.
8. Handle the loading and error states explicitly everywhere (loading skeleton or "Loading…",
   error banner with a retry). A dashboard that silently renders empty on a failed fetch is a bug.
9. Delete the plan-01 placeholder health UI. `/api/health` stays as an endpoint.

## Acceptance criteria

- [ ] `npm run typecheck`, `npm test`, `npm run build` pass.
- [ ] First visit with no cookie shows the nickname gate; after submitting, the dashboard renders
      and a reload keeps the identity (cookie survives).
- [ ] Deep-linking to `/m/ABCDEF` while anonymous shows the gate, then lands on that match page.
- [ ] Creating a match navigates to `/m/:code` and the code is visible and copyable.
- [ ] A second browser profile can join by pasting the code (including lowercase/whitespace, via
      `normalizeMatchCode`) and then sees the match on its dashboard.
- [ ] The dashboard renders the three buckets with counts, and empty buckets show explanatory text.
- [ ] All client fetches send `credentials: "same-origin"`; a 401 routes back to the nickname gate
      rather than showing a raw error.
- [ ] No new runtime dependencies added (no router, no UI kit, no CSS framework).
- [ ] Client reuses types and `normalizeMatchCode` from `shared/`; no duplicated definitions.
- [ ] Usable at 360 px wide.

## Verification

```bash
cd /home/stefano/workspace/party-dev
npm run typecheck && npm test && npm run build
npm run db:migrate:local
npm run dev
```

Then in a browser (and a second private window for the second player):
1. Load `/` → nickname gate → enter "alice" → dashboard.
2. Create a Connect 4 match → lands on `/m/<CODE>` with the code shown.
3. Private window → `/` → "bob" → paste the code into Join → same match page, both players listed.
4. Both dashboards list the match under "Waiting on others" (nothing is waiting on anyone yet).
5. Reload both windows: identity and match list persist.
6. Navigate directly to `/m/<CODE>` in a fresh tab: renders (SPA fallback works, not a 404).

## Risks / notes

- The dashboard's three buckets read D1, which plan 02 only ever writes with `waiting = 0`. "Your
  turn" will therefore be empty until plan 04 computes `waitingOn`. That is expected — build the
  bucket UI now and do not fake the data.
- Do not add optimistic local state for match lists; a stale list plus a refresh button is honest,
  and plan 05 replaces the polling with live updates.
- Clipboard API requires a secure context; on plain http `localhost` it works, but fall back to
  selecting the text if `navigator.clipboard` is unavailable.
- Keep `MatchPage` thin. It becomes the host for the live transport (plan 05) and lazily loaded game
  UIs (plans 06/07); resist putting game-specific logic in it.
