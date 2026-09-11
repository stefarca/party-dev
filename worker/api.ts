import { Hono } from "hono";

import { GAME_CATALOG, getGameMeta } from "../games/catalog";
import { MATCH_CODE_RE, generateMatchCode, normalizeMatchCode } from "../shared/ids";
import {
  ActionRequestSchema,
  CreateMatchRequestSchema,
  IdentityRequestSchema,
  JoinMatchRequestSchema,
} from "../shared/protocol";
import type { MatchSummary } from "../shared/protocol";
import type { Session, SessionBindings } from "./auth";
import { MissingSecretError, requireSession, sessionMiddleware, writeSession } from "./auth";

export const api = new Hono<SessionBindings>();

api.onError((err, c) => {
  if (err instanceof MissingSecretError) {
    return c.json({ error: "missing_binding", binding: "SESSION_SECRET" }, 500);
  }
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});

// Parses the session cookie (if any) for every /api/* route. Missing an
// identity is not itself an error here — requireSession() below is what
// enforces that on the routes that need one.
api.use("*", sessionMiddleware());

api.get("/health", async (c) => {
  let doResult: unknown;
  try {
    const id = c.env.MATCH.idFromName("health");
    const stub = c.env.MATCH.get(id);
    const res = await stub.fetch("http://do/ping");
    doResult = await res.json();
  } catch (err) {
    return c.json({ ok: false, subsystem: "do", error: String(err) }, 500);
  }

  let matches: number;
  try {
    const row = await c.env.DB.prepare("SELECT count(*) AS n FROM matches").first<{ n: number }>();
    matches = row?.n ?? 0;
  } catch (err) {
    return c.json({ ok: false, subsystem: "d1", error: String(err) }, 500);
  }

  return c.json({
    ok: true,
    now: Date.now(),
    do: doResult,
    d1: { matches },
  });
});

api.get("/games", (c) => c.json(GAME_CATALOG));

async function readJsonBody(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

api.post("/identity", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const parsed = IdentityRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }

  const existing = c.get("session");
  const session: Session = existing
    ? { pid: existing.pid, nick: parsed.data.nickname, iat: existing.iat }
    : { pid: crypto.randomUUID(), nick: parsed.data.nickname, iat: Date.now() };

  await writeSession(c, session);
  return c.json({ playerId: session.pid, nickname: session.nick });
});

api.get("/me", requireSession(), (c) => {
  const session = c.get("session") as Session;
  return c.json({ playerId: session.pid, nickname: session.nick });
});

api.post("/matches", requireSession(), async (c) => {
  const body = await readJsonBody(c.req.raw);
  const parsed = CreateMatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const meta = getGameMeta(parsed.data.gameId);
  if (!meta) {
    return c.json({ error: "unknown_game" }, 400);
  }

  const session = c.get("session") as Session;
  const now = Date.now();

  // This INSERT is only a collision reservation on the code, not the
  // authoritative index write — MatchDO.syncIndex() (called via
  // /lobby/create below) is what writes the real matches/match_players rows
  // once the DO has accepted the match (§6: D1 is derived, the DO is
  // authoritative). We retry on a PRIMARY KEY collision, capped at 5
  // attempts (32^6 codes makes repeated collisions vanishingly unlikely).
  let matchId: string | null = null;
  for (let attempt = 0; attempt < 5 && !matchId; attempt++) {
    const code = generateMatchCode();
    try {
      await c.env.DB.prepare(
        "INSERT INTO matches (id, game_id, status, created_at, updated_at, deadline) VALUES (?, ?, 'lobby', ?, ?, NULL)"
      )
        .bind(code, parsed.data.gameId, now, now)
        .run();
      matchId = code;
    } catch {
      // Assume a PRIMARY KEY collision on `id` and retry with a new code.
    }
  }
  if (!matchId) {
    return c.json({ error: "code_exhausted" }, 500);
  }

  try {
    const id = c.env.MATCH.idFromName(matchId);
    const stub = c.env.MATCH.get(id);
    const res = await stub.fetch("http://do/lobby/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        matchId,
        gameId: parsed.data.gameId,
        host: { id: session.pid, nickname: session.nick },
      }),
    });
    if (!res.ok) throw new Error(`lobby create failed with status ${res.status}`);
  } catch (err) {
    // The DO create failed after we reserved the code in D1 — delete the
    // reservation so the code is not left as an orphan row (see Risks/notes
    // in the plan).
    await c.env.DB.prepare("DELETE FROM matches WHERE id = ?").bind(matchId).run();
    console.error("match create failed", err);
    return c.json({ error: "create_failed" }, 500);
  }

  return c.json({ matchId, code: matchId });
});

// Unknown/malformed codes 404 before the auth check (an unrecognized code
// leaks nothing about whether the caller is logged in, and this is what the
// plan's own verification script expects); a *recognized* code still
// requires a session to actually join.
api.post("/matches/:code/join", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const parsed = JoinMatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }

  const code = normalizeMatchCode(c.req.param("code"));
  if (!MATCH_CODE_RE.test(code)) {
    return c.json({ error: "not_found" }, 404);
  }

  const row = await c.env.DB.prepare("SELECT id FROM matches WHERE id = ?").bind(code).first();
  if (!row) {
    return c.json({ error: "not_found" }, 404);
  }

  const session = c.get("session");
  if (!session) {
    return c.json({ error: "no_identity" }, 401);
  }

  const id = c.env.MATCH.idFromName(code);
  const stub = c.env.MATCH.get(id);
  const res = await stub.fetch("http://do/lobby/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: session.pid, nickname: session.nick }),
  });

  if (res.status === 404) return c.json({ error: "not_found" }, 404);
  if (res.status === 409) return c.json(await res.json(), 409);
  if (!res.ok) return c.json({ error: "join_failed" }, 500);

  return c.json(await res.json());
});

// Not covered by plan 02 (which only ever routed to the DO's own
// GET /snapshot internally) — plan 03's MatchPage needs a REST-reachable
// equivalent to render the lobby, so it is added here rather than left as a
// gap. Unlike the join route above, auth is checked first (via
// requireSession() middleware) — an unauthenticated caller gets 401
// regardless of whether the code is valid, which is intentionally more
// conservative than join's not-found-before-auth ordering. No per-player
// view yet (see MatchDO.handleSnapshot).
api.get("/matches/:code", requireSession(), async (c) => {
  const code = normalizeMatchCode(c.req.param("code"));
  if (!MATCH_CODE_RE.test(code)) {
    return c.json({ error: "not_found" }, 404);
  }

  const id = c.env.MATCH.idFromName(code);
  const stub = c.env.MATCH.get(id);
  const res = await stub.fetch("http://do/snapshot");
  if (res.status === 404) return c.json({ error: "not_found" }, 404);
  if (!res.ok) return c.json({ error: "snapshot_failed" }, 500);

  return c.json(await res.json());
});

// HTTP fallbacks for the live match transport (PLAN.md §7: "treat WS as an
// optimization over 'fetch state on load', never as the only path"). Both
// return/accept exactly the same shapes as the WS `snapshot`/`action`
// messages (shared/protocol.ts's MatchSnapshot) — plan 05's client can use
// either transport interchangeably.
api.get("/matches/:id/snapshot", requireSession(), async (c) => {
  const session = c.get("session") as Session;
  const code = normalizeMatchCode(c.req.param("id"));
  if (!MATCH_CODE_RE.test(code)) {
    return c.json({ error: "not_found" }, 404);
  }

  const id = c.env.MATCH.idFromName(code);
  const stub = c.env.MATCH.get(id);
  const res = await stub.fetch(
    `http://do/view?playerId=${encodeURIComponent(session.pid)}`
  );
  if (res.status === 404) return c.json(await res.json(), 404);
  if (res.status === 403) return c.json(await res.json(), 403);
  if (!res.ok) return c.json({ error: "snapshot_failed" }, 500);

  return c.json(await res.json());
});

api.post("/matches/:id/actions", requireSession(), async (c) => {
  const session = c.get("session") as Session;
  const code = normalizeMatchCode(c.req.param("id"));
  if (!MATCH_CODE_RE.test(code)) {
    return c.json({ error: "not_found" }, 404);
  }

  const body = await readJsonBody(c.req.raw);
  const parsed = ActionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }

  const id = c.env.MATCH.idFromName(code);
  const stub = c.env.MATCH.get(id);
  const res = await stub.fetch("http://do/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: session.pid, action: parsed.data.action }),
  });
  if (res.status === 404) return c.json(await res.json(), 404);
  if (res.status === 409) return c.json(await res.json(), 409);
  if (res.status === 400) return c.json(await res.json(), 400);
  if (!res.ok) return c.json({ error: "action_failed" }, 500);

  return c.json(await res.json());
});

interface MatchIndexRow {
  id: string;
  game_id: string;
  status: MatchSummary["status"];
  host_id: string | null;
  updated_at: number;
  deadline: number | null;
  my_waiting: number;
  player_id: string;
  nickname: string | null;
}

api.get("/matches", requireSession(), async (c) => {
  const session = c.get("session") as Session;

  // One D1 query for the caller's matches, joined against match_players
  // twice: once to find the caller's own matches + waiting flag, once more
  // to pull every player row for those matches, so the dashboard needs no
  // per-match follow-up query.
  const { results } = await c.env.DB.prepare(
    `SELECT m.id AS id, m.game_id AS game_id, m.status AS status, m.host_id AS host_id,
            m.updated_at AS updated_at, m.deadline AS deadline,
            mine.waiting AS my_waiting,
            p.player_id AS player_id, p.nickname AS nickname
     FROM matches m
     JOIN match_players mine ON mine.match_id = m.id AND mine.player_id = ?
     JOIN match_players p ON p.match_id = m.id
     ORDER BY m.updated_at DESC`
  )
    .bind(session.pid)
    .all<MatchIndexRow>();

  const order: string[] = [];
  const summaries = new Map<string, MatchSummary>();
  const myWaiting = new Map<string, boolean>();

  for (const row of results) {
    let summary = summaries.get(row.id);
    if (!summary) {
      summary = {
        id: row.id,
        gameId: row.game_id,
        status: row.status,
        players: [],
        hostId: row.host_id ?? "",
        waiting: Boolean(row.my_waiting),
        updatedAt: row.updated_at,
        deadline: row.deadline,
      };
      summaries.set(row.id, summary);
      myWaiting.set(row.id, Boolean(row.my_waiting));
      order.push(row.id);
    }
    summary.players.push({ id: row.player_id, nickname: row.nickname ?? "" });
  }

  const yourTurn: MatchSummary[] = [];
  const waiting: MatchSummary[] = [];
  const finished: MatchSummary[] = [];
  for (const id of order) {
    const summary = summaries.get(id) as MatchSummary;
    if (summary.status === "done") {
      if (finished.length < 50) finished.push(summary);
    } else if (myWaiting.get(id)) {
      if (yourTurn.length < 50) yourTurn.push(summary);
    } else {
      if (waiting.length < 50) waiting.push(summary);
    }
  }

  return c.json({ yourTurn, waiting, finished });
});

api.notFound((c) => c.json({ ok: false, error: "not found" }, 404));
