import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

import { getGameMeta } from "../games/catalog";
import { getGame } from "../games/registry";
import type { GameModule, Result } from "../shared/game";
import { PRESENCE_WINDOW_MS } from "../shared/heartbeat";
import { HISTORY_LIMIT } from "../shared/history";
import { UNKNOWN_NICKNAME } from "../shared/nickname";
import { ClientMessageSchema, MatchVisibilitySchema } from "../shared/protocol";
import type {
  MatchEvent,
  MatchEventPayload,
  MatchSnapshot,
  MatchStatus,
  MatchSummary,
  MatchVisibility,
  PlayerId,
  PlayerInfo,
  ServerMessage,
} from "../shared/protocol";
import { sendSlackNudge, shouldNudge } from "./nudge";
import type { NudgeKind } from "./nudge";
import { sendPushNudges } from "./push";

// Durable Object gotchas that apply to every method added to this class:
// - Hibernation API only: use `ctx.acceptWebSocket()` / `webSocketMessage()`
//   handlers, never the browser-style WebSocket event-binding API — that
//   pins the DO in memory and bills idle lobbies for nothing.
// - Never a timer-based interval. Use `ctx.storage.setAlarm()`.
// - Hibernation wipes in-memory state; persist to `ctx.storage` on every
//   mutation and rehydrate from it on every request rather than caching it
//   on `this` (the DO holds no per-request cache of the match record).
//
// This class is the game engine: the move pipeline (`commit`), the event
// log, alarm-driven `onDeadline`, and hibernatable WebSockets. It holds no
// game-specific knowledge — games come from `games/registry.ts`.

// Ids only. A player's name is identity, not match data — it lives in the
// `players` registry and is looked up whenever a roster leaves this object
// (see `readNamedMatch()`), so a rename reaches every match at once.
interface MatchPlayerRecord {
  id: string;
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
  // Whether the hub lists this lobby for anyone to join. Absent on records
  // created before it existed, which are all private.
  visibility?: MatchVisibility;
  // While the lobby is public: when it comes off the hub unless somebody
  // joins first. Every join starts the day over.
  publicUntil?: number;
  createdAt: number;
  updatedAt: number;
  seed: number; // rolled once at create time, never re-rolled
  state: unknown | null;
  // Nudge rate limit: the epoch ms each player was last nudged and has not
  // moved since, keyed by playerId. Lives on the DO record rather than a D1
  // column — see the comment on `nudgeHook` below. A player's entry is
  // dropped when they act (`handleAction`), which is what answers a nudge;
  // an absent entry means there is no unanswered nudge to hold back for.
  nudgedAt: Record<PlayerId, number>;
}

// Per-connection attachment: hibernation wipes in-memory
// state, so identity travels on `ws.serializeAttachment()`, never in an
// in-memory Map keyed by socket.
interface ConnectionAttachment {
  playerId: string;
  // When the socket was accepted: the page's first sign of life, standing in
  // for a heartbeat until its first "ping" (see `isWatching()`).
  connectedAt: number;
}

type ActionResult =
  { ok: true; snapshot: MatchSnapshot } | { ok: false; code: string; message: string };

type MutationResult = { ok: true } | { ok: false; code: string; message: string };

const LobbyCreateBody = z.object({
  matchId: z.string().min(1),
  gameId: z.string().min(1),
  hostId: z.string().min(1),
  visibility: MatchVisibilitySchema.default("private"),
});

const ActorBody = z.object({ playerId: z.string().min(1) });
const VisibilityBody = z.object({
  playerId: z.string().min(1),
  visibility: MatchVisibilitySchema,
});
const ActionBody = z.object({ playerId: z.string().min(1), action: z.unknown() });

// How long a public lobby stays on the hub with nobody joining it.
const PUBLIC_LISTING_MS = 24 * 60 * 60 * 1000;

// When `record`'s place on the hub runs out, or null if it has none: it is
// private, or no longer a lobby.
function listingExpiry(record: MatchRecord): number | null {
  return record.status === "lobby" && record.visibility === "public"
    ? (record.publicUntil ?? null)
    : null;
}

// Whether `record` is a lobby with every seat taken, so all that is left is
// for the host to start it. Every game's `maxPlayers` is at least its
// `minPlayers`, so a full lobby can always be started.
function lobbyIsFull(record: MatchRecord): boolean {
  const maxPlayers = getGame(record.gameId)?.meta.maxPlayers ?? Infinity;
  return record.status === "lobby" && record.players.length >= maxPlayers;
}

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

// Who a finished match counts as a win for, in the one place the D1 index
// needs to agree with every game at once. A "scores" result has no declared
// winner, so the top score takes it and a tie counts for everyone on it —
// the same reading the scoreboard UI gives.
function winnersOf(result: Result | null): Set<PlayerId> {
  if (result === null || result.kind === "draw") return new Set();
  if (result.kind === "win") return new Set(result.winners);
  const scores = Object.entries(result.scores);
  if (scores.length === 0) return new Set();
  const best = Math.max(...scores.map(([, score]) => score));
  return new Set(scores.filter(([, score]) => score === best).map(([id]) => id));
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
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
    // Append-only event log.
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, payload TEXT)",
    );
    // Hibernation-safe keepalive: the runtime answers a raw "ping"
    // text frame with "pong" itself, without ever waking this DO. This is
    // the preferred mechanism over the app-level `{t:"ping"}` message (see
    // webSocketMessage's "ping" case) — configure one or the other for
    // actual heartbeat traffic, never both, or keepalives double up and
    // waste the 20:1-billed inbound message budget. The client
    // transport relies on this and does not send `{t:"ping"}`.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/ping") {
      const row = this.ctx.storage.sql.exec("SELECT count(*) AS n FROM sqlite_master").one() as {
        n: number;
      };
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

    if (request.method === "POST" && url.pathname === "/lobby/visibility") {
      return this.handleVisibilityRequest(request);
    }

    if (request.method === "GET" && url.pathname === "/snapshot") {
      return this.handleLobbySnapshot();
    }

    if (request.method === "GET" && url.pathname === "/view") {
      return this.handleViewRequest(url);
    }

    if (request.method === "GET" && url.pathname === "/events") {
      return this.handleEventsRequest(url);
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
      JSON.stringify(record),
    );
  }

  // Returns the new row's seq.
  private appendEvent(payload: MatchEventPayload): number {
    const ts = Date.now();
    this.ctx.storage.sql.exec(
      "INSERT INTO events (ts, payload) VALUES (?, ?)",
      ts,
      JSON.stringify(payload),
    );
    const row = this.ctx.storage.sql.exec("SELECT last_insert_rowid() AS seq").one() as {
      seq: number;
    };
    return row.seq;
  }

  private eventsSince(since: number, limit = HISTORY_LIMIT): MatchEvent[] {
    const rows = this.ctx.storage.sql
      .exec(
        "SELECT seq, ts, payload FROM events WHERE seq > ? ORDER BY seq ASC LIMIT ?",
        since,
        limit,
      )
      .toArray() as { seq: number; ts: number; payload: string }[];
    return rows.map((r) => ({ seq: r.seq, ts: r.ts, payload: JSON.parse(r.payload) }));
  }

  // The *newest* `limit` events after `since`, still returned oldest-first.
  // `eventsSince` above is the catch-up read — it takes the oldest rows in
  // the gap, which is what a reconnecting socket needs next. A page that
  // just loaded wants the other end: the tail of a long match, not its
  // opening moves.
  private recentEvents(since: number, limit = HISTORY_LIMIT): MatchEvent[] {
    const rows = this.ctx.storage.sql
      .exec(
        "SELECT seq, ts, payload FROM events WHERE seq > ? ORDER BY seq DESC LIMIT ?",
        since,
        limit,
      )
      .toArray() as { seq: number; ts: number; payload: string }[];
    return rows.map((r) => ({ seq: r.seq, ts: r.ts, payload: JSON.parse(r.payload) })).reverse();
  }

  private currentSeq(): number {
    const row = this.ctx.storage.sql
      .exec("SELECT COALESCE(MAX(seq), 0) AS seq FROM events")
      .one() as { seq: number };
    return row.seq;
  }

  // Looks up the display names of `ids` in the player registry. Never throws:
  // a failed lookup costs the names (they show as UNKNOWN_NICKNAME until the
  // next snapshot), never the snapshot itself — and `alarm()` and
  // `webSocketMessage()` both reach this through commit(), where a throw is
  // not allowed.
  private async lookupNames(ids: PlayerId[]): Promise<Map<PlayerId, string>> {
    const names = new Map<PlayerId, string>();
    if (ids.length === 0) return names;
    try {
      const { results } = await this.env.DB.prepare(
        `SELECT id, nickname FROM players WHERE id IN (${ids.map(() => "?").join(", ")})`,
      )
        .bind(...ids)
        .all<{ id: string; nickname: string }>();
      for (const row of results) names.set(row.id, row.nickname);
    } catch (err) {
      console.error("player name lookup failed", err);
    }
    return names;
  }

  // The match as it stands once every player in it has been named. The
  // lookup is an await, and a join can land during it, so the record is
  // re-read after each lookup and whoever that join added is looked up in
  // turn. An id is never asked for twice, so one the registry has no row for
  // cannot keep this looping. Callers use the record returned here, never
  // one they read before calling it.
  private async readNamedMatch(): Promise<{
    record: MatchRecord;
    names: Map<PlayerId, string>;
  } | null> {
    let record = this.readMatch();
    const names = new Map<PlayerId, string>();
    const asked = new Set<PlayerId>();
    while (record) {
      const missing = record.players.map((p) => p.id).filter((id) => !asked.has(id));
      if (missing.length === 0) break;
      for (const id of missing) asked.add(id);
      for (const [id, name] of await this.lookupNames(missing)) names.set(id, name);
      record = this.readMatch();
    }
    return record ? { record, names } : null;
  }

  private rosterOf(record: MatchRecord, names: Map<PlayerId, string>): PlayerInfo[] {
    return record.players.map((p) => ({ id: p.id, nickname: names.get(p.id) ?? UNKNOWN_NICKNAME }));
  }

  private toSummary(record: MatchRecord, names: Map<PlayerId, string>): MatchSummary {
    return {
      id: record.id,
      gameId: record.gameId,
      status: record.status,
      players: this.rosterOf(record, names),
      hostId: record.hostId,
      waiting: false, // lobby-only summary — see handleLobbySnapshot below.
      updatedAt: record.updatedAt,
      deadline: null,
      visibility: record.visibility ?? "private",
    };
  }

  // Builds the MatchSnapshot for one specific player — never raw state.
  // Shared by the WS `hello`/action-result replies, the
  // broadcast in `commit()`, and the HTTP `/view` fallback, so all three
  // transports agree on exactly one shape.
  private snapshotFor(
    record: MatchRecord,
    playerId: PlayerId,
    names: Map<PlayerId, string>,
  ): MatchSnapshot {
    const module = getGame(record.gameId) as GameModule<unknown, unknown> | undefined;
    const state = record.state;
    const hasState = module !== undefined && state !== null;
    return {
      seq: this.currentSeq(),
      status: record.status,
      players: this.rosterOf(record, names),
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

  // Whether `playerId` has this match in front of them right now, which is
  // what spares them a nudge. An open socket alone does not say so: a laptop
  // that went to sleep, or a phone that dropped off its network, leaves one
  // behind that nobody closed, and the runtime can go on listing it long
  // after the page is gone. So a socket counts only while it keeps up the
  // page's heartbeat — the raw "ping" the runtime answers on its own and
  // timestamps for us, without waking this object. A page that goes hidden
  // closes its socket (web/useMatch.ts), so a background tab or a
  // backgrounded app counts as away too.
  private isWatching(playerId: PlayerId, now: number): boolean {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as ConnectionAttachment | null;
      if (attachment?.playerId !== playerId) continue;
      const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
      if (now - Math.max(lastPing, attachment.connectedAt) < PRESENCE_WINDOW_MS) return true;
    }
    return false;
  }

  // Recomputes waitingOn/deadline from whatever `record` currently holds.
  // Pulled out of commit() because commit() must call this fresh after
  // *every* await it takes, not just once — see the comments inside
  // commit() for why.
  private deriveWaitingAndDeadline(
    module: GameModule<unknown, unknown> | undefined,
    record: MatchRecord,
  ): { waitingOn: PlayerId[]; deadline: number | null } {
    const state = record.state;
    const hasState = module !== undefined && state !== null;
    return {
      waitingOn: hasState ? module.waitingOn(state) : [],
      deadline: hasState ? module.deadline(state) : null,
    };
  }

  // ---------------------------------------------------------------------
  // The move pipeline, in its binding order. Every mutation path —
  // join, start, action, alarm — funnels through this single method.
  // ---------------------------------------------------------------------

  private async commit(record: MatchRecord, events: MatchEventPayload[]): Promise<void> {
    const module = getGame(record.gameId) as GameModule<unknown, unknown> | undefined;

    // Read the previously-persisted waitingOn *before* overwriting the
    // record, so stage 7 can compute which players are newly waited-on.
    const priorRecord = this.readMatch();
    const previousWaiting =
      module && priorRecord?.state != null ? module.waitingOn(priorRecord.state) : [];
    const wasFull = priorRecord !== null && lobbyIsFull(priorRecord);

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
    // method — see Cloudflare's DO concurrency model). If
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
    // value. A lobby has no game and so no deadline; a public one sets the
    // alarm for when its listing runs out instead (see `expireListing()`).
    const wakeAt = derived.deadline ?? listingExpiry(current);
    if (wakeAt !== null) {
      if (existingAlarm !== wakeAt) await this.ctx.storage.setAlarm(wakeAt);
    } else if (existingAlarm !== null) {
      await this.ctx.storage.deleteAlarm();
    }

    // 5. Broadcast a per-player snapshot to every connected socket, using
    // that socket's own view(state, playerId) — N tailored messages, never
    // one shared payload. O(players) view() + JSON
    // serialization per commit; fine for the <=8-player games this engine
    // targets, but keep reducers/views small (the 10ms CPU budget
    // applies here too).
    //
    // The roster is named from the player registry first, which is await
    // #3. `readNamedMatch()` reads the record right after await #2
    // (setAlarm/deleteAlarm, when either ran) and again after its own
    // lookup, so the `current` it returns is fresh as of both — a fully
    // independent commit could have run to completion during either. The
    // loop itself has no `await` in it, so `current`/`derived` stay valid
    // for its entire duration.
    const named = await this.readNamedMatch();
    current = named?.record ?? record;
    const names = named?.names ?? new Map<PlayerId, string>();
    // eslint-disable-next-line no-useless-assignment -- recomputed from the fresh `current` for symmetry with the other stages; no stage reads it before the re-read after await #4 below
    derived = this.deriveWaitingAndDeadline(module, current);
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as ConnectionAttachment | null;
      if (!attachment) continue;
      const snapshot = this.snapshotFor(current, attachment.playerId, names);
      this.safeSend(ws, { t: "snapshot", ...snapshot });
      if (newEvents.length > 0) {
        this.safeSend(ws, { t: "events", events: newEvents });
      }
    }

    // 6. Update the D1 index (derived state). `syncIndex()` takes no
    // arguments and re-reads canonical state itself, at whatever instant
    // its own turn in `dbWriteQueue` actually starts — see the comment on
    // `dbWriteQueue` for why re-reading here in commit(), before calling
    // it, would not be enough on its own.
    await this.syncIndex();

    // Re-read after await #4 (syncIndex's internal `env.DB.batch` call) —
    // same reasoning as after the awaits before it.
    current = this.readMatch() ?? record;
    derived = this.deriveWaitingAndDeadline(module, current);

    // 7. Nudge players newly waited-on who are not watching, and the host of
    // a lobby this commit filled.
    // `newlyWaiting` is computed from `current`/`derived` above — the
    // freshest truth after every prior stage's await — and from
    // `previousWaiting` captured before this commit touched anything, so a
    // player who left and came back to `waitingOn` during this same commit
    // (however unlikely) is correctly treated as newly-waiting too. This
    // also covers the alarm-driven `deadline_resolved` path (e.g. trivia's
    // next-round transition): `alarm()` funnels through this same `commit()`
    // (see its own comment), so a round of new waiters created there nudges
    // exactly like a normal move would.
    const newlyWaiting = derived.waitingOn.filter((id) => !previousWaiting.includes(id));
    // `priorRecord` is null only for the create itself, which seats the host
    // alone and which the host is looking at.
    if (priorRecord !== null && !wasFull && lobbyIsFull(current)) this.lobbyFullHook(current);
    await this.nudgeHook(current, newlyWaiting);
  }

  // Tells the host of a lobby that has just filled that it is ready to start,
  // unless they are watching it. A lobby waits on nobody (`waitingOn` is the
  // game's, and there is no game until Start), so `nudgeHook` never covers
  // this. It needs no rate limit: nobody leaves a lobby, so it fills once.
  private lobbyFullHook(record: MatchRecord): void {
    if (this.isWatching(record.hostId, Date.now())) return;
    this.sendNudges(record, [record.hostId], "lobbyFull");
  }

  // Nudge every player in `newlyWaiting` who is not watching the match,
  // rate-limited to one nudge per player per match per turn plus a floor for
  // nudges nobody answered — see `shouldNudge` in worker/nudge.ts for the
  // exact rule. Several players becoming newly-waited-on in the same commit
  // (e.g. a trivia round start) produce exactly one batched Slack message,
  // never one per player.
  //
  // Two channels, one decision: the Slack webhook (one message for the
  // whole batch, to a shared channel) and web push (one notification per
  // device that opted in, to that player alone). Both are driven by the same
  // eligibility above, so turning one on does not double the other.
  //
  // `nudgedAt` lives on this DO's own record rather than in a D1 column,
  // because the DO is authoritative and this avoids
  // a read-modify-write against derived state on every single move. No D1
  // migration is needed.
  private async nudgeHook(record: MatchRecord, newlyWaiting: PlayerId[]): Promise<void> {
    if (newlyWaiting.length === 0) return;

    // `newlyWaiting` members all transitioned into `waitingOn` in this very
    // commit, so "now" doubles as every one of their `becameWaitingAt`.
    const now = Date.now();
    const away = newlyWaiting.filter((id) => !this.isWatching(id, now));
    if (away.length === 0) return;

    const eligible = away.filter((id) => shouldNudge(record.nudgedAt[id], id, now, now));
    if (eligible.length === 0) return;

    // Persist the updated `nudgedAt` entries as part of this same,
    // synchronous write — nothing has been `await`ed between the fresh
    // `record` this method was handed (re-read right before this call, see
    // commit()'s stage 7) and this line, so it carries none of the
    // interleaving risk commit()'s own later re-reads guard against.
    for (const id of eligible) record.nudgedAt[id] = now;
    this.writeMatch(record);

    const playerIds = eligible.filter((id) => record.players.some((p) => p.id === id));
    if (playerIds.length === 0) return;
    this.sendNudges(record, playerIds, "turn");
  }

  // Delivers one nudge decision to `playerIds` through both channels.
  private sendNudges(record: MatchRecord, playerIds: PlayerId[], kind: NudgeKind): void {
    const meta = getGameMeta(record.gameId);
    const url = `${this.env.PUBLIC_BASE_URL}/m/${record.id}`;

    // Both channels name players — Slack the ones it is nudging, a push
    // notification the reader's opponents — so the whole roster is looked up
    // once and each channel chains off that one lookup in a `waitUntil()` of
    // its own. The move's response is never blocked on either, and neither
    // waits on the other's round-trips or is lost to the other's failure.
    // `lookupNames`, `sendSlackNudge` and `sendPushNudges` never throw; the
    // `.catch`es are belt-and-suspenders against a future regression there.
    const roster = this.lookupNames(record.players.map((p) => p.id)).then((names) =>
      this.rosterOf(record, names),
    );

    this.ctx.waitUntil(
      roster
        .then((players) =>
          sendSlackNudge(this.env, {
            matchId: record.id,
            gameName: meta?.name ?? record.gameId,
            players: players.filter((p) => playerIds.includes(p.id)),
            url,
            kind,
          }),
        )
        .catch((err) => {
          console.error("sendNudges: sendSlackNudge rejected unexpectedly", err);
        }),
    );

    this.ctx.waitUntil(
      roster
        .then((players) =>
          sendPushNudges(this.env, {
            matchId: record.id,
            gameId: record.gameId,
            playerIds,
            players,
            kind,
          }),
        )
        .catch((err) => {
          console.error("sendNudges: sendPushNudges rejected unexpectedly", err);
        }),
    );
  }

  // ---------------------------------------------------------------------
  // Lobby routes (funnelled through commit(), like every mutation path).
  // ---------------------------------------------------------------------

  private async handleLobbyCreate(request: Request): Promise<Response> {
    const parsed = LobbyCreateBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }
    if (this.readMatch()) {
      return Response.json({ ok: false, error: "already_exists" }, { status: 409 });
    }

    const { matchId, gameId, hostId, visibility } = parsed.data;
    const now = Date.now();
    const record: MatchRecord = {
      id: matchId,
      gameId,
      status: "lobby",
      hostId,
      players: [{ id: hostId, joinedAt: now }],
      visibility,
      ...(visibility === "public" ? { publicUntil: now + PUBLIC_LISTING_MS } : {}),
      createdAt: now,
      updatedAt: now,
      seed: Math.floor(Math.random() * 2 ** 31),
      state: null,
      nudgedAt: {},
    };
    await this.commit(record, [{ type: "player_joined", id: hostId }]);
    return this.namedSummaryResponse();
  }

  // The lobby summary every lobby route replies with, named as of now.
  private async namedSummaryResponse(): Promise<Response> {
    const named = await this.readNamedMatch();
    if (!named) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    return Response.json(this.toSummary(named.record, named.names));
  }

  private async handleLobbyJoin(request: Request): Promise<Response> {
    const parsed = ActorBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }
    const record = this.readMatch();
    if (!record) {
      return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    const id = parsed.data.playerId;
    // A re-join is idempotent and succeeds regardless of match status. It
    // changes nothing, so there is nothing to commit.
    if (!record.players.some((p) => p.id === id)) {
      if (record.status !== "lobby") {
        return Response.json({ ok: false, error: "not_joinable" }, { status: 409 });
      }
      const meta = getGameMeta(record.gameId);
      const maxPlayers = meta?.maxPlayers ?? Infinity;
      if (record.players.length >= maxPlayers) {
        return Response.json({ ok: false, error: "lobby_full" }, { status: 409 });
      }
      const now = Date.now();
      record.players.push({ id, joinedAt: now });
      if (record.visibility === "public") record.publicUntil = now + PUBLIC_LISTING_MS;
      await this.commit(record, [{ type: "player_joined", id }]);
    }
    return this.namedSummaryResponse();
  }

  // Lists the lobby on every hub for a day, or takes it off. It changes who
  // may join, which is the host's call, and means nothing once the match has
  // started: only a lobby accepts new players. Logs no event — nothing about
  // the game itself happened. An unchanged setting commits nothing.
  private async setVisibility(
    playerId: PlayerId,
    visibility: MatchVisibility,
  ): Promise<MutationResult> {
    const record = this.readMatch();
    if (!record) return { ok: false, code: "not_found", message: "match not found" };
    if (record.status !== "lobby") {
      return { ok: false, code: "already_started", message: "match has already started" };
    }
    if (record.hostId !== playerId) {
      return { ok: false, code: "not_host", message: "only the host can change who can join" };
    }
    if ((record.visibility ?? "private") !== visibility) {
      record.visibility = visibility;
      if (visibility === "public") record.publicUntil = Date.now() + PUBLIC_LISTING_MS;
      else delete record.publicUntil;
      await this.commit(record, []);
    }
    return { ok: true };
  }

  private async handleVisibilityRequest(request: Request): Promise<Response> {
    const parsed = VisibilityBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });

    const result = await this.setVisibility(parsed.data.playerId, parsed.data.visibility);
    if (!result.ok) {
      return Response.json(
        { error: result.code, message: result.message },
        { status: statusForCode(result.code) },
      );
    }
    return this.namedSummaryResponse();
  }

  // This route stays a lobby-only summary — a MatchSnapshot with a real
  // per-player `view` is served separately by GET /view, GET /ws and the
  // /action fallback. `/api/matches/:code` is the only caller.
  private handleLobbySnapshot(): Promise<Response> {
    return this.namedSummaryResponse();
  }

  // D1 is derived state: the DO stays authoritative even if this write
  // fails, and the index can be repaired later. Never fail the caller's
  // mutation because the index sync failed, and — critically inside
  // alarm() — never let this throw, or a retry storm could double-resolve
  // a round.
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
    const result = module && record.state !== null ? module.result(record.state) : null;
    const winners = winnersOf(result);
    try {
      const waitingSet = new Set(waitingOn);
      const statements = [
        this.env.DB.prepare(
          `INSERT INTO matches (id, game_id, status, created_at, updated_at, deadline, host_id, result_kind, visibility)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             game_id = excluded.game_id,
             status = excluded.status,
             updated_at = excluded.updated_at,
             deadline = excluded.deadline,
             host_id = excluded.host_id,
             result_kind = excluded.result_kind,
             visibility = excluded.visibility`,
        ).bind(
          record.id,
          record.gameId,
          record.status,
          record.createdAt,
          record.updatedAt,
          deadline,
          record.hostId,
          result?.kind ?? null,
          record.visibility ?? "private",
        ),
        ...record.players.map((p) =>
          this.env.DB.prepare(
            `INSERT INTO match_players (match_id, player_id, waiting, won)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(match_id, player_id) DO UPDATE SET
               waiting = excluded.waiting,
               won = excluded.won`,
          ).bind(record.id, p.id, waitingSet.has(p.id) ? 1 : 0, winners.has(p.id) ? 1 : 0),
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

    // Check order: resolve the module -> parse the action
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

    // What gets logged is the game's own description of the move when it
    // has one, and the raw action only when it does not. The distinction
    // matters beyond readability: events are broadcast to every connected
    // player, so logging a raw action would hand a simultaneous game's
    // opponents a move that `view()` deliberately hides. A throwing
    // `describeAction` must not cost the player their move — the action
    // itself already succeeded — so it falls back to the raw form.
    let logged: MatchEventPayload;
    try {
      const described = module.describeAction?.(record.state, parsedAction.data, playerId);
      logged = described
        ? { type: "action", by: playerId, describe: described }
        : { type: "action", by: playerId, action: parsedAction.data };
    } catch (err) {
      console.error("describeAction threw", err);
      logged = { type: "action", by: playerId, action: parsedAction.data };
    }

    record.state = nextState;
    // Moving answers whatever nudge brought this player here, so the next
    // turn that comes back to them can nudge again straight away instead of
    // waiting out the floor that holds back nudges nobody answered.
    delete record.nudgedAt[playerId];
    await this.commit(record, [logged]);
    const snapshot = await this.namedSnapshotFor(playerId);
    if (!snapshot) return { ok: false, code: "not_found", message: "match not found" };
    return { ok: true, snapshot };
  }

  // `playerId`'s snapshot of the match as it stands now, with its players
  // named. Null only when there is no match.
  private async namedSnapshotFor(playerId: PlayerId): Promise<MatchSnapshot | null> {
    const named = await this.readNamedMatch();
    return named ? this.snapshotFor(named.record, playerId, named.names) : null;
  }

  private async handleViewRequest(url: URL): Promise<Response> {
    const playerId = url.searchParams.get("playerId");
    if (!playerId) return Response.json({ error: "missing_player" }, { status: 400 });
    const record = this.readMatch();
    if (!record) return Response.json({ error: "not_found" }, { status: 404 });
    if (!record.players.some((p) => p.id === playerId)) {
      return Response.json({ error: "not_a_player" }, { status: 403 });
    }
    const snapshot = await this.namedSnapshotFor(playerId);
    if (!snapshot) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json(snapshot);
  }

  // The HTTP equivalent of the WS `hello` -> `events` backfill. Membership
  // is checked exactly as `/view` checks it: the log names who joined and
  // what they played, so it is no more public than the per-player snapshot.
  private handleEventsRequest(url: URL): Response {
    const playerId = url.searchParams.get("playerId");
    if (!playerId) return Response.json({ error: "missing_player" }, { status: 400 });
    const record = this.readMatch();
    if (!record) return Response.json({ error: "not_found" }, { status: 404 });
    if (!record.players.some((p) => p.id === playerId)) {
      return Response.json({ error: "not_a_player" }, { status: 403 });
    }
    const rawSince = Number(url.searchParams.get("since") ?? "0");
    const since = Number.isFinite(rawSince) && rawSince > 0 ? Math.floor(rawSince) : 0;
    return Response.json({ events: this.recentEvents(since) });
  }

  private async handleStartRequest(request: Request): Promise<Response> {
    const parsed = ActorBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });

    const result = await this.startMatch(parsed.data.playerId);
    if (!result.ok) {
      return Response.json(
        { error: result.code, message: result.message },
        { status: statusForCode(result.code) },
      );
    }
    const snapshot = await this.namedSnapshotFor(parsed.data.playerId);
    if (!snapshot) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json(snapshot);
  }

  private async handleActionRequest(request: Request): Promise<Response> {
    const parsed = ActionBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });

    const result = await this.handleAction(parsed.data.playerId, parsed.data.action);
    if (!result.ok) {
      return Response.json(
        { error: result.code, message: result.message },
        { status: statusForCode(result.code) },
      );
    }
    return Response.json(result.snapshot);
  }

  // ---------------------------------------------------------------------
  // Alarm-driven onDeadline.
  // ---------------------------------------------------------------------

  async alarm(): Promise<void> {
    const record = this.readMatch();
    if (record?.status === "lobby") {
      await this.expireListing(record);
      return;
    }
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
      // Never throw out of alarm(): a throw is retried up to 6 times,
      // and a retry storm could double-resolve a round if
      // onDeadline is not perfectly idempotent. Log and give up on this
      // fire — the next legitimate mutation (a move, or the next scheduled
      // alarm) will recover.
      console.error("onDeadline threw", err);
      return;
    }

    // Idempotency guard: the module contract requires
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

  // A public lobby nobody has joined for a day comes off the hub by turning
  // private, which is all the listing ever was. It stays a lobby, its code
  // still works, and the host can list it again for another day. Like the
  // rest of alarm(), it must not throw, and commit() does not.
  private async expireListing(record: MatchRecord): Promise<void> {
    const due = listingExpiry(record);
    if (due === null) return;
    if (Date.now() < due) {
      // Spurious/early fire — reschedule and return without mutating state.
      await this.ctx.storage.setAlarm(due);
      return;
    }
    record.visibility = "private";
    delete record.publicUntil;
    await this.commit(record, []);
  }

  // ---------------------------------------------------------------------
  // Hibernatable WebSockets.
  // ---------------------------------------------------------------------

  private handleWsUpgrade(request: Request): Response {
    const playerId = request.headers.get("X-Player-Id");
    if (!playerId) {
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
    server.serializeAttachment({
      playerId,
      connectedAt: Date.now(),
    } satisfies ConnectionAttachment);
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
      this.safeSend(ws, {
        t: "error",
        code: "invalid_json",
        message: "message was not valid JSON",
      });
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
          const snapshot = await this.namedSnapshotFor(attachment.playerId);
          if (!snapshot) {
            this.safeSend(ws, { t: "error", code: "not_found", message: "match not found" });
            return;
          }
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
      // would otherwise kill the socket.
      console.error("webSocketMessage failed", err);
      this.safeSend(ws, { t: "error", code: "internal_error", message: "internal error" });
    }
  }

  async webSocketClose(
    _ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    // Nothing to clean up: there is no in-memory connection map (hibernation
    // wipes it anyway) — ctx.getWebSockets() always enumerates live sockets
    // directly from the runtime.
  }

  async webSocketError(_ws: WebSocket, error: unknown): Promise<void> {
    console.error("websocket error", error);
  }
}
