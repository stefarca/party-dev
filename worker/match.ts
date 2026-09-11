import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

import { getGameMeta } from "../games/catalog";
import type { MatchStatus, MatchSummary } from "../shared/protocol";

// PLAN.md §10 gotchas that apply to every method added to this class:
// - Hibernation API only: use `ctx.acceptWebSocket()` / `webSocketMessage()`
//   handlers, never `ws.addEventListener` — the latter pins the DO in memory
//   and bills idle lobbies for nothing.
// - Never `setInterval`. Use `ctx.storage.setAlarm()`.
// - Hibernation wipes in-memory state; persist to `ctx.storage` on every
//   mutation and rehydrate from it in the constructor. This plan (02) reads
//   the record fresh from storage on every request rather than caching it
//   on `this` — plan 04 may introduce a guarded in-constructor rehydrate.
//
// This plan gives MatchDO a persisted lobby record (players, status) but
// still no game rules, no WebSocket, and no alarms — those are plan 04.

interface MatchPlayerRecord {
  id: string;
  nickname: string;
  joinedAt: number;
}

// Server-internal shape; not shared with the client (that's MatchSummary in
// shared/protocol.ts), so it lives here rather than in shared/.
interface MatchRecord {
  id: string;
  gameId: string;
  status: MatchStatus;
  hostId: string;
  players: MatchPlayerRecord[];
  createdAt: number;
  updatedAt: number;
  seed: number; // rolled once at create time, never re-rolled (PLAN.md §5 rule 3)
  state: unknown | null;
}

const LobbyCreateBody = z.object({
  matchId: z.string().min(1),
  gameId: z.string().min(1),
  host: z.object({
    id: z.string().min(1),
    nickname: z.string().min(1),
  }),
});

const LobbyJoinBody = z.object({
  id: z.string().min(1),
  nickname: z.string().min(1),
});

export class MatchDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)"
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/ping") {
      const row = this.ctx.storage.sql
        .exec("SELECT count(*) AS n FROM sqlite_master")
        .one() as { n: number };
      return Response.json({
        ok: true,
        id: this.ctx.id.toString(),
        tables: row.n,
      });
    }

    if (request.method === "POST" && url.pathname === "/lobby/create") {
      return this.handleLobbyCreate(request);
    }

    if (request.method === "POST" && url.pathname === "/lobby/join") {
      return this.handleLobbyJoin(request);
    }

    if (request.method === "GET" && url.pathname === "/snapshot") {
      return this.handleSnapshot();
    }

    return Response.json({ ok: false, error: "not found" }, { status: 404 });
  }

  private readMatch(): MatchRecord | null {
    const rows = this.ctx.storage.sql
      .exec("SELECT value FROM meta WHERE key = 'match'")
      .toArray() as { value: string }[];
    if (rows.length === 0) return null;
    return JSON.parse(rows[0].value) as MatchRecord;
  }

  private writeMatch(record: MatchRecord): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO meta (key, value) VALUES ('match', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      JSON.stringify(record)
    );
  }

  private toSummary(record: MatchRecord): MatchSummary {
    return {
      id: record.id,
      gameId: record.gameId,
      status: record.status,
      players: record.players.map((p) => ({ id: p.id, nickname: p.nickname })),
      hostId: record.hostId,
      waiting: false, // no engine yet — plan 04 computes waitingOn per player
      updatedAt: record.updatedAt,
      deadline: null,
    };
  }

  private async handleLobbyCreate(request: Request): Promise<Response> {
    const parsed = LobbyCreateBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }
    if (this.readMatch()) {
      return Response.json({ ok: false, error: "already_exists" }, { status: 409 });
    }

    const { matchId, gameId, host } = parsed.data;
    const now = Date.now();
    const record: MatchRecord = {
      id: matchId,
      gameId,
      status: "lobby",
      hostId: host.id,
      players: [{ id: host.id, nickname: host.nickname, joinedAt: now }],
      createdAt: now,
      updatedAt: now,
      seed: Math.floor(Math.random() * 2 ** 31),
      state: null,
    };
    this.writeMatch(record);
    await this.syncIndex(record);
    return Response.json(this.toSummary(record));
  }

  private async handleLobbyJoin(request: Request): Promise<Response> {
    const parsed = LobbyJoinBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }
    const record = this.readMatch();
    if (!record) {
      return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    const { id, nickname } = parsed.data;
    const existing = record.players.find((p) => p.id === id);
    if (existing) {
      // Idempotent re-join: succeeds regardless of match status. We also
      // lazily refresh the nickname here rather than fanning out nickname
      // changes to every match the player is in — stale opponent names in
      // old matches are acceptable (see plan Risks/notes).
      existing.nickname = nickname;
    } else {
      if (record.status !== "lobby") {
        return Response.json({ ok: false, error: "not_joinable" }, { status: 409 });
      }
      const meta = getGameMeta(record.gameId);
      const maxPlayers = meta?.maxPlayers ?? Infinity;
      if (record.players.length >= maxPlayers) {
        return Response.json({ ok: false, error: "lobby_full" }, { status: 409 });
      }
      record.players.push({ id, nickname, joinedAt: Date.now() });
    }

    record.updatedAt = Date.now();
    this.writeMatch(record);
    await this.syncIndex(record);
    return Response.json(this.toSummary(record));
  }

  private handleSnapshot(): Response {
    const record = this.readMatch();
    if (!record) {
      return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    // No per-player view yet — that arrives with the engine (plan 04). Until
    // then every caller gets the same lobby summary.
    return Response.json(this.toSummary(record));
  }

  // D1 is derived state (§6): the DO stays authoritative even if this write
  // fails, and the index can be repaired later. Never fail the caller's
  // mutation because the index sync failed.
  private async syncIndex(record: MatchRecord): Promise<void> {
    try {
      const statements = [
        this.env.DB.prepare(
          `INSERT INTO matches (id, game_id, status, created_at, updated_at, deadline, host_id)
           VALUES (?, ?, ?, ?, ?, NULL, ?)
           ON CONFLICT(id) DO UPDATE SET
             game_id = excluded.game_id,
             status = excluded.status,
             updated_at = excluded.updated_at,
             deadline = excluded.deadline,
             host_id = excluded.host_id`
        ).bind(record.id, record.gameId, record.status, record.createdAt, record.updatedAt, record.hostId),
        // With no engine yet, nobody is "waiting" in the turn-indicator
        // sense, so `waiting` is 0 for every player.
        ...record.players.map((p) =>
          this.env.DB.prepare(
            `INSERT INTO match_players (match_id, player_id, waiting, nickname)
             VALUES (?, ?, 0, ?)
             ON CONFLICT(match_id, player_id) DO UPDATE SET nickname = excluded.nickname`
          ).bind(record.id, p.id, p.nickname)
        ),
      ];
      await this.env.DB.batch(statements);
    } catch (err) {
      console.error("syncIndex failed", err);
    }
  }
}
