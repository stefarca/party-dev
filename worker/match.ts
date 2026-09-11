import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

import { getGameMeta } from "../games/catalog";
import { getGame } from "../games/registry";
import type { GameModule } from "../shared/game";
import { ClientMessageSchema } from "../shared/protocol";
import type {
  MatchEvent,
  MatchSnapshot,
  MatchStatus,
  MatchSummary,
  PlayerId,
  ServerMessage,
} from "../shared/protocol";

// PLAN.md §10 gotchas that apply to every method added to this class:
// - Hibernation API only: use `ctx.acceptWebSocket()` / `webSocketMessage()`
//   handlers, never the browser-style WebSocket event-binding API — that
//   pins the DO in memory and bills idle lobbies for nothing.
// - Never a timer-based interval. Use `ctx.storage.setAlarm()`.
// - Hibernation wipes in-memory state; persist to `ctx.storage` on every
//   mutation and rehydrate from it on every request rather than caching it
//   on `this` (still true as of this plan — the DO holds no per-request
//   cache of the match record).
//
// This plan (04) adds the game engine: the move pipeline (`commit`), the
// event log, alarm-driven `onDeadline`, and hibernatable WebSockets. No real
// game ships here — `games/registry.ts`'s `serverGames` is still empty.

interface MatchPlayerRecord {
  id: string;
  nickname: string;
  joinedAt: number;
}

// Server-internal shape; not shared with the client (that's MatchSummary /
// MatchSnapshot in shared/protocol.ts), so it lives here rather than in
// shared/.
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

// Per-connection attachment (PLAN.md §10.3): hibernation wipes in-memory
// state, so identity travels on `ws.serializeAttachment()`, never in an
// in-memory Map keyed by socket.
interface ConnectionAttachment {
  playerId: string;
  nickname: string;
}

type ActionResult =
  | { ok: true; snapshot: MatchSnapshot }
  | { ok: false; code: string; message: string };

type MutationResult = { ok: true } | { ok: false; code: string; message: string };

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

const ActorBody = z.object({ playerId: z.string().min(1) });
const ActionBody = z.object({ playerId: z.string().min(1), action: z.unknown() });

// Maps an internal error `code` (see ActionResult/MutationResult above) to
// an HTTP status for the REST fallbacks. The WS path ignores this — errors
// there always go out as a `{ t: "error" }` message on an otherwise-open
// socket (never a thrown exception; see webSocketMessage).
function statusForCode(code: string): number {
  switch (code) {
    case "not_found":
      return 404;
    case "not_host":
      return 403;
    case "not_a_player":
      return 403;
    case "already_started":
    case "not_active":
    case "not_your_turn":
      return 409;
    default:
      return 400;
  }
}

export class MatchDO extends DurableObject<Env> {
  // Serializes every `env.DB.batch()` call this DO instance makes (see
  // `syncIndex()`). Two commits' own D1 writes can otherwise complete out
  // of order — whichever's network round-trip to D1 happens to finish
  // first "wins", even if it was queued by an *older* commit — and
  // re-reading canonical state in `commit()` before calling `syncIndex()`
  // does not close that gap, because by the time this write's own
  // `env.DB.batch()` call is in flight, its payload is already fixed.
  private dbWriteQueue: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)"
    );
    // Append-only event log (PLAN.md §7), verbatim DDL.
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, payload TEXT)"
    );
    // Hibernation-safe keepalive (§10.2): the runtime answers a raw "ping"
    // text frame with "pong" itself, without ever waking this DO. This is
    // the preferred mechanism over the app-level `{t:"ping"}` message (see
    // webSocketMessage's "ping" case) — configure one or the other for
    // actual heartbeat traffic, never both, or keepalives double up and
    // waste the 20:1-billed inbound message budget (§2). The client
    // transport (plan 05) relies on this and does not send `{t:"ping"}`.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
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
      return this.handleLobbySnapshot();
    }

    if (request.method === "GET" && url.pathname === "/view") {
      return this.handleViewRequest(url);
    }

    if (request.method === "POST" && url.pathname === "/start") {
      return this.handleStartRequest(request);
    }

    if (request.method === "POST" && url.pathname === "/action") {
      return this.handleActionRequest(request);
    }

    if (url.pathname === "/ws") {
      return this.handleWsUpgrade(request);
    }

    return Response.json({ ok: false, error: "not found" }, { status: 404 });
  }

  // ---------------------------------------------------------------------
  // Storage helpers
  // ---------------------------------------------------------------------

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

  // Returns the new row's seq, per the plan's exact signature.
  private appendEvent(payload: object): number {
    const ts = Date.now();
    this.ctx.storage.sql.exec(
      "INSERT INTO events (ts, payload) VALUES (?, ?)",
      ts,
      JSON.stringify(payload)
    );
    const row = this.ctx.storage.sql.exec("SELECT last_insert_rowid() AS seq").one() as {
      seq: number;
    };
    return row.seq;
  }

  private eventsSince(since: number, limit = 200): MatchEvent[] {
    const rows = this.ctx.storage.sql
      .exec(
        "SELECT seq, ts, payload FROM events WHERE seq > ? ORDER BY seq ASC LIMIT ?",
        since,
        limit
      )
      .toArray() as { seq: number; ts: number; payload: string }[];
    return rows.map((r) => ({ seq: r.seq, ts: r.ts, payload: JSON.parse(r.payload) }));
  }

  private currentSeq(): number {
    const row = this.ctx.storage.sql
      .exec("SELECT COALESCE(MAX(seq), 0) AS seq FROM events")
      .one() as { seq: number };
    return row.seq;
  }

  private toSummary(record: MatchRecord): MatchSummary {
    return {
      id: record.id,
      gameId: record.gameId,
      status: record.status,
      players: record.players.map((p) => ({ id: p.id, nickname: p.nickname })),
      hostId: record.hostId,
      waiting: false, // lobby-only summary — see handleLobbySnapshot below.
      updatedAt: record.updatedAt,
      deadline: null,
    };
  }

  // Builds the MatchSnapshot for one specific player — never raw state
  // (§5 rule 2). Shared by the WS `hello`/action-result replies, the
  // broadcast in `commit()`, and the HTTP `/view` fallback, so all three
  // transports agree on exactly one shape (§7).
  private snapshotFor(record: MatchRecord, playerId: PlayerId): MatchSnapshot {
    const module = getGame(record.gameId) as GameModule<unknown, unknown> | undefined;
    const state = record.state;
    const hasState = module !== undefined && state !== null;
    return {
      seq: this.currentSeq(),
      status: record.status,
      players: record.players.map((p) => ({ id: p.id, nickname: p.nickname })),
      view: hasState ? module.view(state, playerId) : null,
      waitingOn: hasState ? module.waitingOn(state) : [],
      deadline: hasState ? module.deadline(state) : null,
      result: hasState ? module.result(state) : null,
    };
  }

  private safeSend(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch (err) {
      console.error("websocket send failed", err);
    }
  }

  // Plan 08 needs this to decide who to nudge (only players who are not
  // currently connected).
  private isConnected(playerId: PlayerId): boolean {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as ConnectionAttachment | null;
      if (attachment?.playerId === playerId) return true;
    }
    return false;
  }

  // Recomputes waitingOn/deadline from whatever `record` currently holds.
  // Pulled out of commit() because commit() must call this fresh after
  // *every* await it takes, not just once — see the comments inside
  // commit() for why.
  private deriveWaitingAndDeadline(
    module: GameModule<unknown, unknown> | undefined,
    record: MatchRecord
  ): { waitingOn: PlayerId[]; deadline: number | null } {
    const state = record.state;
    const hasState = module !== undefined && state !== null;
    return {
      waitingOn: hasState ? module.waitingOn(state) : [],
      deadline: hasState ? module.deadline(state) : null,
    };
  }

  // ---------------------------------------------------------------------
  // The move pipeline (PLAN.md §5's binding order). Every mutation path —
  // join, start, action, alarm — funnels through this single method.
  // ---------------------------------------------------------------------

  private async commit(record: MatchRecord, events: object[]): Promise<void> {
    const module = getGame(record.gameId) as GameModule<unknown, unknown> | undefined;

    // Read the previously-persisted waitingOn *before* overwriting the
    // record, so stage 7 can compute which players are newly waited-on.
    const priorRecord = this.readMatch();
    const previousWaiting =
      module && priorRecord?.state != null ? module.waitingOn(priorRecord.state) : [];

    // Auto-finalize: whenever the state a caller just assigned to
    // `record.state` has a non-null result(), the match is done —
    // regardless of *which* mutation path got it there (a normal action
    // that happens to complete the game, or alarm()'s onDeadline). Callers
    // only ever need to assign `record.state` and call commit(); they never
    // have to remember to flip `status` or append `match_finished`
    // themselves. This must happen before stage 1 (persist) so the
    // "done" status is what actually gets written.
    const finalizingState = record.state;
    const finalizingHasState = module !== undefined && finalizingState !== null;
    const finishedResult = finalizingHasState ? module.result(finalizingState) : null;
    const finalEvents = events;
    if (finishedResult !== null && record.status !== "done") {
      record.status = "done";
      finalEvents.push({ type: "match_finished", result: finishedResult });
    }

    // 1. Persist state (+ updatedAt) to the meta table.
    record.updatedAt = Date.now();
    this.writeMatch(record);

    // 2. Append events to the log.
    const seqBefore = this.currentSeq();
    for (const event of finalEvents) this.appendEvent(event);
    const newEvents = this.eventsSince(seqBefore);

    // Stages 1-2 above are entirely synchronous (no `await`), so nothing
    // else can run on this Durable Object in between them and here. Every
    // line below this comment, though, is separated from the next by at
    // least one `await`, and DOs *do* interleave other requests across an
    // await (input gates only protect synchronous sections, not the whole
    // method — see PLAN.md §10 / Cloudflare's DO concurrency model). If
    // another mutation (a second player's action, or an alarm fire) runs to
    // completion during ANY of those awaits, `record` and anything derived
    // from it before that await becomes stale the instant we resume.
    //
    // The rule enforced from here on: after *every* await, re-read
    // `this.readMatch()` and recompute `waitingOn`/`deadline` from that
    // fresh read via `deriveWaitingAndDeadline`, before the next stage
    // consumes either value. `current`/`derived` are therefore reassigned
    // after each await below rather than captured once — a stage may only
    // ever read them if nothing has been awaited since the last
    // reassignment. Falls back to `record` only if somehow nothing has been
    // persisted yet (shouldn't happen: stage 1 always writes first).
    const existingAlarm = await this.ctx.storage.getAlarm();

    // 3. Re-read after await #1 (getAlarm).
    let current = this.readMatch() ?? record;
    let derived = this.deriveWaitingAndDeadline(module, current);

    // 4. Reconcile the DO alarm against the new deadline, using the
    // freshly-read `derived.deadline` above so a commit that got overtaken
    // re-arms (or clears) against the latest truth instead of its own stale
    // value.
    if (derived.deadline !== null) {
      if (existingAlarm !== derived.deadline) await this.ctx.storage.setAlarm(derived.deadline);
    } else if (existingAlarm !== null) {
      await this.ctx.storage.deleteAlarm();
    }

    // Re-read after await #2 (setAlarm/deleteAlarm, when either ran) — a
    // fully independent commit could have run to completion while this one
    // was suspended there, so `current`/`derived` from stage 3 can no
    // longer be trusted.
    current = this.readMatch() ?? record;
    derived = this.deriveWaitingAndDeadline(module, current);

    // 5. Broadcast a per-player snapshot to every connected socket, using
    // that socket's own view(state, playerId) — N tailored messages, never
    // one shared payload (§5 rule 2). O(players) view() + JSON
    // serialization per commit; fine for the <=8-player games this engine
    // targets, but keep reducers/views small (§10.5's 10ms CPU budget
    // applies here too). This loop itself has no `await` in it, so
    // `current`/`derived` re-read immediately above stay valid for its
    // entire duration.
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as ConnectionAttachment | null;
      if (!attachment) continue;
      const snapshot = this.snapshotFor(current, attachment.playerId);
      this.safeSend(ws, { t: "snapshot", ...snapshot });
      if (newEvents.length > 0) {
        this.safeSend(ws, { t: "events", events: newEvents });
      }
    }

    // 6. Update the D1 index (derived state — §6). `syncIndex()` takes no
    // arguments and re-reads canonical state itself, at whatever instant
    // its own turn in `dbWriteQueue` actually starts — see the comment on
    // `dbWriteQueue` for why re-reading here in commit(), before calling
    // it, would not be enough on its own.
    await this.syncIndex();

    // Re-read after await #3 (syncIndex's internal `env.DB.batch` call) —
    // same reasoning as after awaits #1 and #2.
    current = this.readMatch() ?? record;
    derived = this.deriveWaitingAndDeadline(module, current);

    // 7. Nudge players newly waited-on who are not connected. No-op stub
    // for now; plan 08 fills this in. `newlyWaiting` is already correct so
    // that plan is a one-method change.
    const newlyWaiting = derived.waitingOn.filter((id) => !previousWaiting.includes(id));
    await this.nudgeHook(current, newlyWaiting);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- plan 08 fills this in.
  private async nudgeHook(_record: MatchRecord, _newlyWaiting: PlayerId[]): Promise<void> {
    /* plan 08 */
    return;
  }

  // ---------------------------------------------------------------------
  // Lobby routes (unchanged behaviour from plan 02, now funnelled through
  // commit() per PLAN.md §5's "every mutation path" rule).
  // ---------------------------------------------------------------------

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
    await this.commit(record, [
      { type: "player_joined", id: host.id, nickname: host.nickname },
    ]);
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
    const events: object[] = [];
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
      events.push({ type: "player_joined", id, nickname });
    }

    await this.commit(record, events);
    return Response.json(this.toSummary(record));
  }

  // This route stays a lobby-only summary (plan 02/03's shape) even though
  // the engine now exists — a MatchSnapshot with a real per-player `view`
  // is served separately by GET /view, GET /ws and the /action fallback
  // (this plan). `/api/matches/:code` (plan 03) is the only caller.
  private handleLobbySnapshot(): Response {
    const record = this.readMatch();
    if (!record) {
      return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    return Response.json(this.toSummary(record));
  }

  // D1 is derived state (§6): the DO stays authoritative even if this write
  // fails, and the index can be repaired later. Never fail the caller's
  // mutation because the index sync failed, and — critically inside
  // alarm() — never let this throw, or a retry storm could double-resolve
  // a round (§10.6).
  //
  // Deliberately takes no arguments: it enqueues its real work onto
  // `dbWriteQueue` and only reads canonical state (via `writeIndexNow`)
  // once it is actually that queued turn's moment to run — never from
  // whatever `commit()` happened to have on hand when it called this.
  // That is what makes the *last* call to reach the front of the queue
  // also the *last* one to write, and guarantees it always writes whatever
  // is truly latest at that instant, regardless of how many other commits
  // raced it here or how long any of their own D1 round-trips take.
  private async syncIndex(): Promise<void> {
    const task = this.dbWriteQueue.then(() => this.writeIndexNow());
    // Chain the *next* call off this one's settling, not off its success —
    // writeIndexNow() already swallows its own errors, but this belongs
    // here too so one rejected link can never wedge the whole queue.
    this.dbWriteQueue = task.catch(() => {});
    await task;
  }

  private async writeIndexNow(): Promise<void> {
    const record = this.readMatch();
    if (!record) return;
    const module = getGame(record.gameId) as GameModule<unknown, unknown> | undefined;
    const { waitingOn, deadline } = this.deriveWaitingAndDeadline(module, record);
    try {
      const waitingSet = new Set(waitingOn);
      const statements = [
        this.env.DB.prepare(
          `INSERT INTO matches (id, game_id, status, created_at, updated_at, deadline, host_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             game_id = excluded.game_id,
             status = excluded.status,
             updated_at = excluded.updated_at,
             deadline = excluded.deadline,
             host_id = excluded.host_id`
        ).bind(
          record.id,
          record.gameId,
          record.status,
          record.createdAt,
          record.updatedAt,
          deadline,
          record.hostId
        ),
        ...record.players.map((p) =>
          this.env.DB.prepare(
            `INSERT INTO match_players (match_id, player_id, waiting, nickname)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(match_id, player_id) DO UPDATE SET
               waiting = excluded.waiting,
               nickname = excluded.nickname`
          ).bind(record.id, p.id, waitingSet.has(p.id) ? 1 : 0, p.nickname)
        ),
      ];
      await this.env.DB.batch(statements);
    } catch (err) {
      console.error("syncIndex failed", err);
    }
  }

  // ---------------------------------------------------------------------
  // Start / action — the shared logic behind both the HTTP fallback routes
  // and the WebSocket message handlers below.
  // ---------------------------------------------------------------------

  private async startMatch(playerId: PlayerId): Promise<MutationResult> {
    const record = this.readMatch();
    if (!record) return { ok: false, code: "not_found", message: "match not found" };
    if (record.status !== "lobby") {
      return { ok: false, code: "already_started", message: "match has already started" };
    }
    if (record.hostId !== playerId) {
      return { ok: false, code: "not_host", message: "only the host can start the match" };
    }

    const module = getGame(record.gameId) as GameModule<unknown, unknown> | undefined;
    if (!module) return { ok: false, code: "unknown_game", message: "unknown game" };

    const playerIds = record.players.map((p) => p.id);
    if (playerIds.length < module.meta.minPlayers || playerIds.length > module.meta.maxPlayers) {
      return { ok: false, code: "wrong_player_count", message: "player count is out of range" };
    }

    record.status = "active";
    record.state = module.init(playerIds, record.seed);
    await this.commit(record, [{ type: "match_started" }]);
    return { ok: true };
  }

  private async handleAction(playerId: PlayerId, rawAction: unknown): Promise<ActionResult> {
    const record = this.readMatch();
    if (!record) return { ok: false, code: "not_found", message: "match not found" };

    // Plan step 9's literal order: resolve the module -> parse the action
    // -> not-your-turn -> not-active. `waitingOn`/`not_active` both need
    // `record.state`, which is only non-null once the match has actually
    // started, so `not_active` is checked right before `waitingOn` is
    // called rather than being folded into the initial guard — this keeps
    // the ordering intact for the case both conditions are true (an
    // unknown-game or invalid-action report should win over a generic
    // not-your-turn/not-active one).
    const module = getGame(record.gameId) as GameModule<unknown, unknown> | undefined;
    if (!module) return { ok: false, code: "unknown_game", message: "unknown game" };

    const parsedAction = module.actionSchema.safeParse(rawAction);
    if (!parsedAction.success) {
      return { ok: false, code: "invalid_action", message: "invalid action payload" };
    }

    if (record.status !== "active" || record.state == null) {
      return { ok: false, code: "not_active", message: "match is not active" };
    }

    const waitingOn = module.waitingOn(record.state);
    if (!waitingOn.includes(playerId)) {
      return { ok: false, code: "not_your_turn", message: "it is not your turn" };
    }

    let nextState: unknown;
    try {
      nextState = module.reduce(record.state, parsedAction.data, playerId, Date.now());
    } catch (err) {
      // A rules violation inside reduce() must never corrupt state or
      // surface as a 500 — the previously-persisted state is left exactly
      // as it was (we never call commit() on this path).
      const message = err instanceof Error ? err.message : "rules violation";
      return { ok: false, code: "invalid_move", message };
    }

    record.state = nextState;
    await this.commit(record, [{ type: "action", by: playerId, action: parsedAction.data }]);
    return { ok: true, snapshot: this.snapshotFor(record, playerId) };
  }

  private async handleViewRequest(url: URL): Promise<Response> {
    const playerId = url.searchParams.get("playerId");
    if (!playerId) return Response.json({ error: "missing_player" }, { status: 400 });
    const record = this.readMatch();
    if (!record) return Response.json({ error: "not_found" }, { status: 404 });
    if (!record.players.some((p) => p.id === playerId)) {
      return Response.json({ error: "not_a_player" }, { status: 403 });
    }
    return Response.json(this.snapshotFor(record, playerId));
  }

  private async handleStartRequest(request: Request): Promise<Response> {
    const parsed = ActorBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });

    const result = await this.startMatch(parsed.data.playerId);
    if (!result.ok) {
      return Response.json(
        { error: result.code, message: result.message },
        { status: statusForCode(result.code) }
      );
    }
    const record = this.readMatch() as MatchRecord;
    return Response.json(this.snapshotFor(record, parsed.data.playerId));
  }

  private async handleActionRequest(request: Request): Promise<Response> {
    const parsed = ActionBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });

    const result = await this.handleAction(parsed.data.playerId, parsed.data.action);
    if (!result.ok) {
      return Response.json(
        { error: result.code, message: result.message },
        { status: statusForCode(result.code) }
      );
    }
    return Response.json(result.snapshot);
  }

  // ---------------------------------------------------------------------
  // Alarm-driven onDeadline (PLAN.md §5, §10.6).
  // ---------------------------------------------------------------------

  async alarm(): Promise<void> {
    const record = this.readMatch();
    if (!record || record.status !== "active" || record.state == null) return;

    const module = getGame(record.gameId) as GameModule<unknown, unknown> | undefined;
    if (!module) return;

    const due = module.deadline(record.state);
    if (due === null) return;

    const now = Date.now();
    if (now < due) {
      // Spurious/early fire — reschedule and return without mutating state.
      await this.ctx.storage.setAlarm(due);
      return;
    }

    let resolvedState: unknown;
    try {
      resolvedState = module.onDeadline(record.state, now);
    } catch (err) {
      // Never throw out of alarm(): a throw is retried up to 6 times
      // (§10.6), and a retry storm could double-resolve a round if
      // onDeadline is not perfectly idempotent. Log and give up on this
      // fire — the next legitimate mutation (a move, or the next scheduled
      // alarm) will recover.
      console.error("onDeadline threw", err);
      return;
    }

    // Idempotency guard (§5 rule 4 / §10.6): the module contract requires
    // onDeadline to key its resolution on the round/phase number and no-op
    // on an already-resolved round. This is a belt-and-suspenders check —
    // if the deadline genuinely did not advance, do not loop by
    // rescheduling the same alarm over and over.
    const dueAfter = module.deadline(resolvedState);
    if (dueAfter === due) {
      console.error("onDeadline did not advance the deadline; not looping", {
        matchId: record.id,
      });
      return;
    }

    record.state = resolvedState;
    // commit() itself detects `result(resolvedState) !== null`, flips
    // `status` to "done" and appends `match_finished` — see the
    // "auto-finalize" comment at the top of commit(). It also recomputes
    // waitingOn/deadline from the new state, which is `[]`/`null` once
    // finished — that is what clears the alarm and zeroes every
    // match_players.waiting row via syncIndex.
    await this.commit(record, [{ type: "deadline_resolved", round: due }]);
  }

  // ---------------------------------------------------------------------
  // Hibernatable WebSockets (PLAN.md §10.2/§10.3).
  // ---------------------------------------------------------------------

  private handleWsUpgrade(request: Request): Response {
    const playerId = request.headers.get("X-Player-Id");
    const nickname = request.headers.get("X-Player-Nickname");
    if (!playerId || !nickname) {
      return Response.json({ error: "missing_identity" }, { status: 400 });
    }

    const record = this.readMatch();
    if (!record) return Response.json({ error: "not_found" }, { status: 404 });
    if (!record.players.some((p) => p.id === playerId)) {
      return Response.json({ error: "not_a_player" }, { status: 403 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId, nickname } satisfies ConnectionAttachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as ConnectionAttachment | null;
    if (!attachment) {
      this.safeSend(ws, {
        t: "error",
        code: "no_identity",
        message: "socket has no attached identity",
      });
      return;
    }

    let raw: unknown;
    try {
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      raw = JSON.parse(text);
    } catch {
      this.safeSend(ws, { t: "error", code: "invalid_json", message: "message was not valid JSON" });
      return;
    }

    const parsed = ClientMessageSchema.safeParse(raw);
    if (!parsed.success) {
      // Invalid/hostile payloads always become an `error` message and must
      // never throw out of this handler — a throw kills the socket.
      this.safeSend(ws, {
        t: "error",
        code: "invalid_message",
        message: "unrecognized message shape",
      });
      return;
    }

    try {
      const msg = parsed.data;
      switch (msg.t) {
        case "hello": {
          const record = this.readMatch();
          if (!record) {
            this.safeSend(ws, { t: "error", code: "not_found", message: "match not found" });
            return;
          }
          const snapshot = this.snapshotFor(record, attachment.playerId);
          this.safeSend(ws, { t: "snapshot", ...snapshot });
          const events = this.eventsSince(msg.since);
          if (events.length > 0) this.safeSend(ws, { t: "events", events });
          return;
        }
        case "start": {
          const result = await this.startMatch(attachment.playerId);
          if (!result.ok) {
            this.safeSend(ws, { t: "error", code: result.code, message: result.message });
          }
          return;
        }
        case "action": {
          const result = await this.handleAction(attachment.playerId, msg.action);
          if (!result.ok) {
            this.safeSend(ws, { t: "error", code: result.code, message: result.message });
          }
          return;
        }
        case "ping": {
          // See the constructor comment: real keepalives should never
          // reach here (they are answered by the raw ping/pong
          // auto-response pair without waking the DO). This exists only so
          // an app-level `{t:"ping"}` from a non-conforming client still
          // gets an answer instead of an `error`.
          this.safeSend(ws, { t: "pong" });
          return;
        }
      }
    } catch (err) {
      // Belt-and-suspenders: nothing above should throw, but a throw here
      // would otherwise kill the socket (§10.2/step 11).
      console.error("webSocketMessage failed", err);
      this.safeSend(ws, { t: "error", code: "internal_error", message: "internal error" });
    }
  }

  async webSocketClose(
    _ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean
  ): Promise<void> {
    // Nothing to clean up: there is no in-memory connection map (hibernation
    // wipes it anyway) — ctx.getWebSockets() always enumerates live sockets
    // directly from the runtime.
  }

  async webSocketError(_ws: WebSocket, error: unknown): Promise<void> {
    console.error("websocket error", error);
  }
}
