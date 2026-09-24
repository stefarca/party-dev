import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { GAME_CATALOG, getDailyMeta, getGameMeta } from "../games/catalog";
import { dayEnd, dayOf, isDay } from "../shared/daily";
import { MATCH_CODE_RE, generateMatchCode, normalizeMatchCode } from "../shared/ids";
import {
  ActionRequestSchema,
  CreateMatchRequestSchema,
  DailyFinishRequestSchema,
  DailyStartRequestSchema,
  IdentityRequestSchema,
  JoinMatchRequestSchema,
  PushSubscribeRequestSchema,
  PushUnsubscribeRequestSchema,
  SetVisibilityRequestSchema,
  StartMatchRequestSchema,
} from "../shared/protocol";
import type {
  DailyHub,
  DailyRunSnapshot,
  DailyToday,
  Leaderboard,
  MatchSummary,
  PlayerStatsDetail,
  PushKeyResponse,
} from "../shared/protocol";
import type { Session, SessionBindings } from "./auth";
import {
  MissingSecretError,
  clearSession,
  requireSession,
  sessionMiddleware,
  writeSession,
} from "./auth";
import { dailyChart, dailySummaries } from "./chart";
import { runName } from "./daily";
import { HUB_LIST_LIMIT, openMatches, summarize } from "./hub";
import type { MatchIndexRow } from "./hub";
import {
  NicknameTakenError,
  findPlayerById,
  playerStats,
  renamePlayer,
  resetStats,
  signIn,
} from "./players";
import { forgetSubscription, pushPublicKey, saveSubscription } from "./push";
import { leaderboard, playerStatsDetail, playerStreaks } from "./stats";

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

// Sign in, and rename. Which one it is depends on whether the caller
// already has a session, and the difference matters:
//
//  - no session: whoever holds this nickname *is* who you are signing in
//    as, matches and record included. That is what makes the app work on a
//    second device, and it is also why there is nothing here stopping you
//    from signing in as a coworker — a nickname is a claim, not a proof.
//  - a session: you keep your player id and move it onto the new nickname,
//    so nothing you have played is left behind. A nickname somebody else
//    holds is refused rather than silently switching you into their
//    account; signing out first is the way to do that on purpose.
api.post("/identity", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const parsed = IdentityRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }

  const existing = c.get("session");
  let player;
  try {
    player = existing
      ? await renamePlayer(c.env.DB, existing.pid, parsed.data.nickname)
      : await signIn(c.env.DB, parsed.data.nickname);
  } catch (err) {
    if (err instanceof NicknameTakenError) {
      return c.json({ error: "nickname_taken" }, 409);
    }
    throw err;
  }

  const session: Session = {
    pid: player.id,
    nick: player.nickname,
    iat: existing?.iat ?? Date.now(),
  };
  await writeSession(c, session);
  return c.json({ playerId: session.pid, nickname: session.nick });
});

// Drops the cookie, so the next load shows the nickname gate. The only way
// to sign in as a different player on a device that already has a session.
api.post("/identity/signout", (c) => {
  clearSession(c);
  return c.json({ ok: true });
});

// The registry, not the cookie, is the authority on who the caller is: a
// rename made on another device has to reach this one.
//
// A cookie can also name a player the registry has no row for — one minted
// before the registry existed who never played a match (so the backfill
// never saw them), or one minted by the previous Worker in the window
// between a deploy's migration and its new code going live. Such a
// session is registered under its own nickname if that is still free,
// rather than sent back to the gate to become someone new. Only if another
// player already holds that nickname is the cookie dropped.
api.get("/me", requireSession(), async (c) => {
  const session = c.get("session") as Session;
  let player = await findPlayerById(c.env.DB, session.pid);
  if (!player) {
    try {
      player = await renamePlayer(c.env.DB, session.pid, session.nick);
    } catch (err) {
      if (!(err instanceof NicknameTakenError)) throw err;
      clearSession(c);
      return c.json({ error: "no_identity" }, 401);
    }
  }
  if (player.nickname !== session.nick) {
    await writeSession(c, { ...session, nick: player.nickname });
  }
  return c.json({ playerId: player.id, nickname: player.nickname });
});

// Starts the caller's record over, and only the record: every match it
// counted stays in the index and on the hub. Replies with the new record so
// the hub can show it without refetching everything. GET /me registers any
// session the registry is missing on page load, so a missing row here means
// the session no longer names a player.
api.post("/me/stats/reset", requireSession(), async (c) => {
  const session = c.get("session") as Session;
  if (!(await resetStats(c.env.DB, session.pid))) {
    return c.json({ error: "no_identity" }, 401);
  }
  return c.json(await playerStats(c.env.DB, session.pid));
});

// Everything the stats page shows about the caller: their record game by
// game, their streaks, their rivalries and how quickly they reply.
api.get("/me/stats", requireSession(), async (c) => {
  const session = c.get("session") as Session;
  return c.json<PlayerStatsDetail>(await playerStatsDetail(c.env.DB, session.pid, Date.now()));
});

// The last seven days for everyone: who won most, and who kept matches
// waiting longest. The same for every caller, but a session is still asked
// for, like every other read of who played what.
api.get("/leaderboard", requireSession(), async (c) =>
  c.json<Leaderboard>(await leaderboard(c.env.DB, Date.now())),
);

// Web push, which is a property of one browser rather than of an account:
// a player who opts in on their phone has said nothing about their laptop.
// The rows live in D1 (`push_subscriptions`) and are read from `MatchDO` on
// the same turn boundary that posts to Slack.

// The application server key every subscription has to be created with, or
// null where this deployment has no VAPID keys and can send nothing. Public
// by nature — it travels inside every subscription — so it is served like
// the game catalog, without a session. The client asks for it before it
// offers a player anything, so a deployment without keys shows no
// notification control at all rather than one that cannot work.
api.get("/push/key", (c) => c.json<PushKeyResponse>({ key: pushPublicKey(c.env) }));

// Records this browser as a device to nudge. Idempotent: a browser keeps one
// subscription per origin, and re-sending it is how the client refreshes the
// language or hands over a rotated endpoint.
api.post("/push/subscribe", requireSession(), async (c) => {
  const body = await readJsonBody(c.req.raw);
  const parsed = PushSubscribeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }

  const session = c.get("session") as Session;
  const { subscription, language, replaces } = parsed.data;
  await saveSubscription(
    c.env.DB,
    session.pid,
    {
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    language ?? null,
    replaces,
  );
  return c.json({ ok: true });
});

// Stops nudging this browser. Deleting a row that is not there is a success:
// the caller's intent — "do not notify this device" — holds either way.
api.post("/push/unsubscribe", requireSession(), async (c) => {
  const body = await readJsonBody(c.req.raw);
  const parsed = PushUnsubscribeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }

  const session = c.get("session") as Session;
  await forgetSubscription(c.env.DB, session.pid, parsed.data.endpoint);
  return c.json({ ok: true });
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
  if (meta.comingSoon) {
    return c.json({ error: "game_unavailable" }, 409);
  }

  const session = c.get("session") as Session;
  const now = Date.now();

  // This INSERT is only a collision reservation on the code, not the
  // authoritative index write — MatchDO.syncIndex() (called via
  // /lobby/create below) is what writes the real matches/match_players rows
  // once the DO has accepted the match (D1 is derived, the DO is
  // authoritative). We retry on a PRIMARY KEY collision, capped at 5
  // attempts (32^6 codes makes repeated collisions vanishingly unlikely).
  let matchId: string | null = null;
  for (let attempt = 0; attempt < 5 && !matchId; attempt++) {
    const code = generateMatchCode();
    try {
      await c.env.DB.prepare(
        "INSERT INTO matches (id, game_id, status, created_at, updated_at, deadline) VALUES (?, ?, 'lobby', ?, ?, NULL)",
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
        hostId: session.pid,
        visibility: parsed.data.visibility,
      }),
    });
    if (!res.ok) throw new Error(`lobby create failed with status ${res.status}`);
  } catch (err) {
    // The DO create failed after we reserved the code in D1 — delete the
    // reservation so the code is not left as an orphan row.
    await c.env.DB.prepare("DELETE FROM matches WHERE id = ?").bind(matchId).run();
    console.error("match create failed", err);
    return c.json({ error: "create_failed" }, 500);
  }

  return c.json({ matchId, code: matchId });
});

// Unknown/malformed codes 404 before the auth check (an unrecognized code
// leaks nothing about whether the caller is logged in); a *recognized*
// code still requires a session to actually join.
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
    body: JSON.stringify({ playerId: session.pid }),
  });

  if (res.status === 404) return c.json({ error: "not_found" }, 404);
  if (res.status === 409) return c.json(await res.json(), 409);
  if (!res.ok) return c.json({ error: "join_failed" }, 500);

  return c.json(await res.json());
});

// REST equivalent of the DO's internal GET /snapshot, so MatchPage can
// render the lobby. Unlike the join route above, auth is checked first (via
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

// HTTP fallbacks for the live match transport ("treat WS as an
// optimization over 'fetch state on load', never as the only path"). Both
// return/accept exactly the same shapes as the WS `snapshot`/`action`
// messages (shared/protocol.ts's MatchSnapshot) — the client can use
// either transport interchangeably.
api.get("/matches/:id/snapshot", requireSession(), async (c) => {
  const session = c.get("session") as Session;
  const code = normalizeMatchCode(c.req.param("id"));
  if (!MATCH_CODE_RE.test(code)) {
    return c.json({ error: "not_found" }, 404);
  }

  const id = c.env.MATCH.idFromName(code);
  const stub = c.env.MATCH.get(id);
  const res = await stub.fetch(`http://do/view?playerId=${encodeURIComponent(session.pid)}`);
  if (res.status === 404) return c.json(await res.json(), 404);
  if (res.status === 403) return c.json(await res.json(), 403);
  if (!res.ok) return c.json({ error: "snapshot_failed" }, 500);

  return c.json(await res.json());
});

// The event log over HTTP. Not a fallback like the two routes below it —
// this is the *only* way a page that has just loaded can fill its history
// panel. The WS `hello` backfill only ever returns events newer than the
// `since` the client already has, and a fresh page's first snapshot puts
// `since` at the latest seq, so without this route a reload would show an
// empty history until the next move.
api.get("/matches/:id/events", requireSession(), async (c) => {
  const session = c.get("session") as Session;
  const code = normalizeMatchCode(c.req.param("id"));
  if (!MATCH_CODE_RE.test(code)) {
    return c.json({ error: "not_found" }, 404);
  }

  const since = c.req.query("since") ?? "0";
  const id = c.env.MATCH.idFromName(code);
  const stub = c.env.MATCH.get(id);
  const res = await stub.fetch(
    `http://do/events?playerId=${encodeURIComponent(session.pid)}&since=${encodeURIComponent(since)}`,
  );
  if (res.status === 404) return c.json(await res.json(), 404);
  if (res.status === 403) return c.json(await res.json(), 403);
  if (!res.ok) return c.json({ error: "events_failed" }, 500);

  return c.json(await res.json());
});

// HTTP fallback for starting a match via the DO's `/start` route (also used
// internally by the WS `{ t: "start" }` handler) — without this, a blocked
// WebSocket would leave the host with no way to start a match at all,
// contradicting "WS is an optimization ... never the only path".
// Mirrors the /actions route immediately below one-for-one.
api.post("/matches/:id/start", requireSession(), async (c) => {
  const session = c.get("session") as Session;
  const code = normalizeMatchCode(c.req.param("id"));
  if (!MATCH_CODE_RE.test(code)) {
    return c.json({ error: "not_found" }, 404);
  }

  const body = await readJsonBody(c.req.raw);
  const parsed = StartMatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }

  const id = c.env.MATCH.idFromName(code);
  const stub = c.env.MATCH.get(id);
  const res = await stub.fetch("http://do/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: session.pid }),
  });
  if (res.status === 404) return c.json(await res.json(), 404);
  if (res.status === 409) return c.json(await res.json(), 409);
  if (res.status === 403) return c.json(await res.json(), 403);
  if (res.status === 400) return c.json(await res.json(), 400);
  if (!res.ok) return c.json({ error: "start_failed" }, 500);

  return c.json(await res.json());
});

// Lists the lobby on every player's hub, or takes it off again. Host-only and
// lobby-only, both checked by the DO. Replies with the lobby summary, so the
// host's page can show the setting that actually took.
api.post("/matches/:id/visibility", requireSession(), async (c) => {
  const session = c.get("session") as Session;
  const code = normalizeMatchCode(c.req.param("id"));
  if (!MATCH_CODE_RE.test(code)) {
    return c.json({ error: "not_found" }, 404);
  }

  const body = await readJsonBody(c.req.raw);
  const parsed = SetVisibilityRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }

  const id = c.env.MATCH.idFromName(code);
  const stub = c.env.MATCH.get(id);
  const res = await stub.fetch("http://do/lobby/visibility", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: session.pid, visibility: parsed.data.visibility }),
  });
  if (res.status === 404) return c.json(await res.json(), 404);
  if (res.status === 409) return c.json(await res.json(), 409);
  if (res.status === 403) return c.json(await res.json(), 403);
  if (res.status === 400) return c.json(await res.json(), 400);
  if (!res.ok) return c.json({ error: "visibility_failed" }, 500);

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

api.get("/matches", requireSession(), async (c) => {
  const session = c.get("session") as Session;

  // One D1 query for the caller's matches, joined against match_players
  // twice: once to find the caller's own matches + waiting flag, once more
  // to pull every player row for those matches, so the dashboard needs no
  // per-match follow-up query. The index holds player ids only; each name
  // comes from the registry, so a rename shows on every card at once.
  const mine = c.env.DB.prepare(
    `SELECT m.id AS id, m.game_id AS game_id, m.status AS status, m.host_id AS host_id,
            m.updated_at AS updated_at, m.deadline AS deadline, m.visibility AS visibility,
            mine.waiting AS my_waiting,
            p.player_id AS player_id, pl.nickname AS nickname
     FROM matches m
     JOIN match_players mine ON mine.match_id = m.id AND mine.player_id = ?
     JOIN match_players p ON p.match_id = m.id
     LEFT JOIN players pl ON pl.id = p.player_id
     ORDER BY m.updated_at DESC`,
  )
    .bind(session.pid)
    .all<MatchIndexRow>();

  // The record travels with the player id, so it follows them onto a new
  // device the moment the nickname signs them back in. Fetched alongside
  // the buckets rather than from a route of its own — it reads the same two
  // tables, and the hub draws both in one pass. So are the player's streaks,
  // which the hub shows beside it, and the list of public lobbies, which
  // fills the hub's last tab.
  const [{ results }, open, stats, streaks] = await Promise.all([
    mine,
    openMatches(c.env.DB, session.pid),
    playerStats(c.env.DB, session.pid),
    playerStreaks(c.env.DB, session.pid, Date.now()),
  ]);

  const yourTurn: MatchSummary[] = [];
  const waiting: MatchSummary[] = [];
  const finished: MatchSummary[] = [];
  for (const summary of summarize(results)) {
    if (summary.status === "done") {
      if (finished.length < HUB_LIST_LIMIT) finished.push(summary);
    } else if (summary.waiting) {
      if (yourTurn.length < HUB_LIST_LIMIT) yourTurn.push(summary);
    } else {
      if (waiting.length < HUB_LIST_LIMIT) waiting.push(summary);
    }
  }

  return c.json({ yourTurn, waiting, finished, open, stats, streaks });
});

// ---------------------------------------------------------------------------
// Daily games. Each run is its own DailyDO, named by game, day and player, so
// these routes hold no run state and never need to look one up: the session
// says who, the path says which game, and the server's clock (or the path,
// for a run already under way) says which day. A run's day is never taken
// from anything but the path it was started on, and start always means today.
// ---------------------------------------------------------------------------

function dailyRun(env: Env, gameId: string, day: string, playerId: string) {
  return env.DAILY.get(env.DAILY.idFromName(runName(gameId, day, playerId)));
}

// A DailyDO's reply, passed through: its error codes are the ones the client
// has words for. Only a failure it did not explain becomes `fallback`.
async function relayDaily(
  c: Context<SessionBindings>,
  res: Response,
  fallback: string,
): Promise<Response> {
  if (res.ok || (res.status >= 400 && res.status < 500)) {
    return c.json(await res.json(), res.status as ContentfulStatusCode);
  }
  return c.json({ error: fallback }, 500);
}

// Today's daily games, as the hub shows them.
api.get("/daily", requireSession(), async (c) => {
  const session = c.get("session") as Session;
  const day = dayOf(Date.now());
  const games = await dailySummaries(c.env.DB, day, session.pid);
  return c.json<DailyHub>({ day, endsAt: dayEnd(day), games });
});

// The caller's run at `gameId` today, or null if they have not started one.
api.get("/daily/:gameId", requireSession(), async (c) => {
  const session = c.get("session") as Session;
  const gameId = c.req.param("gameId");
  if (!getDailyMeta(gameId)) return c.json({ error: "unknown_game" }, 404);

  const day = dayOf(Date.now());
  const res = await dailyRun(c.env, gameId, day, session.pid).fetch(
    `http://do/run?playerId=${encodeURIComponent(session.pid)}`,
  );
  if (!res.ok) return relayDaily(c, res, "run_failed");
  const { run } = (await res.json()) as { run: DailyRunSnapshot | null };
  return c.json<DailyToday>({ day, endsAt: dayEnd(day), run });
});

// Starts the caller's run at `gameId` today. Idempotent: a player who already
// has one gets it back as it stands, which is what keeps it to one a day.
api.post("/daily/:gameId/start", requireSession(), async (c) => {
  const session = c.get("session") as Session;
  const gameId = c.req.param("gameId");
  if (!getDailyMeta(gameId)) return c.json({ error: "unknown_game" }, 404);
  const parsed = DailyStartRequestSchema.safeParse(await readJsonBody(c.req.raw));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

  const day = dayOf(Date.now());
  const res = await dailyRun(c.env, gameId, day, session.pid).fetch("http://do/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gameId, day, playerId: session.pid }),
  });
  if (!res.ok) return relayDaily(c, res, "start_failed");
  const run = (await res.json()) as DailyRunSnapshot;
  return c.json<DailyToday>({ day, endsAt: dayEnd(day), run });
});

// One action on the caller's run of `day`. The day is the run's own, from
// the path, so a move made just after midnight reaches the run it was meant
// for and is refused there as `day_over`, rather than landing on a run of
// today's that was never started.
api.post("/daily/:gameId/:day/actions", requireSession(), async (c) => {
  const session = c.get("session") as Session;
  const gameId = c.req.param("gameId");
  const day = c.req.param("day");
  if (!getDailyMeta(gameId)) return c.json({ error: "unknown_game" }, 404);
  if (!isDay(day)) return c.json({ error: "not_found" }, 404);
  const parsed = ActionRequestSchema.safeParse(await readJsonBody(c.req.raw));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

  const res = await dailyRun(c.env, gameId, day, session.pid).fetch("http://do/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: session.pid, action: parsed.data.action }),
  });
  return relayDaily(c, res, "action_failed");
});

// Ends the caller's run of `day` now, as it stands, and puts it on the chart.
api.post("/daily/:gameId/:day/finish", requireSession(), async (c) => {
  const session = c.get("session") as Session;
  const gameId = c.req.param("gameId");
  const day = c.req.param("day");
  if (!getDailyMeta(gameId)) return c.json({ error: "unknown_game" }, 404);
  if (!isDay(day)) return c.json({ error: "not_found" }, 404);
  const parsed = DailyFinishRequestSchema.safeParse(await readJsonBody(c.req.raw));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

  const res = await dailyRun(c.env, gameId, day, session.pid).fetch("http://do/finish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: session.pid }),
  });
  return relayDaily(c, res, "finish_failed");
});

// `gameId`'s chart for `day`, today or any day before it. A day that has not
// begun has no chart, rather than an empty one that says nobody played.
api.get("/daily/:gameId/:day/chart", requireSession(), async (c) => {
  const session = c.get("session") as Session;
  const meta = getDailyMeta(c.req.param("gameId"));
  const day = c.req.param("day");
  if (!meta) return c.json({ error: "unknown_game" }, 404);
  if (!isDay(day) || day > dayOf(Date.now())) return c.json({ error: "not_found" }, 404);
  return c.json(await dailyChart(c.env.DB, meta, day, session.pid));
});

api.notFound((c) => c.json({ ok: false, error: "not found" }, 404));
