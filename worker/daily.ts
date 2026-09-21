import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

import { getDailyGame } from "../games/registry";
import { dayEnd, dayStart, isDay } from "../shared/daily";
import type { DailyGameModule, DailyScore } from "../shared/game";
import type { DailyRunSnapshot, DailyRunStatus, PlayerId } from "../shared/protocol";

// One player's run at one daily game on one day. The object's name is
// `runName(gameId, day, playerId)`, so there is exactly one of these per
// (game, day, player), and that is the whole of the one-run-a-day rule: a
// second start finds the first run already here and hands it back.
//
// The same Durable Object rules as `MatchDO` apply: no timers but the alarm,
// nothing cached on `this` across requests, and `alarm()` never throws. A
// run has one player and no other sockets to keep in step, so there is no
// WebSocket here and no event log; every route replies with the run as it
// now stands.
//
// The run itself is authoritative here. Its row in D1's `daily_runs` is the
// chart's copy, written when the run starts and again when it ends (see
// `syncChart()`), and read by nothing but the chart and the hub.

// Every daily game's board for `day` grows from this seed, the same for every
// player and unguessable without SESSION_SECRET. A seed computed from the
// date alone could be worked out in devtools, along with every tile the day
// will spawn, before a player makes a move. The label keeps it from ever
// coinciding with a session signature made with the same key. Rotating
// SESSION_SECRET mid-day deals a different board to every run started after
// it; a run already started keeps its own, since its state holds its PRNG.
export async function daySeed(secret: string, gameId: string, day: string): Promise<number> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`daily-seed:${gameId}:${day}`));
  return new DataView(mac).getUint32(0);
}

// The name of the Durable Object that holds `playerId`'s run.
export function runName(gameId: string, day: string, playerId: PlayerId): string {
  return `daily:${gameId}:${day}:${playerId}`;
}

// How long to wait before trying again to put a finished run on the chart,
// after D1 turned the write away.
export const CHART_RETRY_MS = 60_000;

interface RunRecord {
  gameId: string;
  day: string;
  playerId: PlayerId;
  status: DailyRunStatus;
  state: unknown;
  startedAt: number;
  finishedAt: number | null;
  // The status the chart's row is known to have: null until the first write
  // lands. When it differs from `status`, the chart is behind.
  charted: DailyRunStatus | null;
}

type Module = DailyGameModule<unknown, unknown>;

const StartBody = z.object({
  gameId: z.string().min(1),
  day: z.string(),
  playerId: z.string().min(1),
});
const ActorBody = z.object({ playerId: z.string().min(1) });
const ActionBody = z.object({ playerId: z.string().min(1), action: z.unknown() });

function failure(code: string, status: number, message: string): Response {
  return Response.json({ error: code, message }, { status });
}

// Never throws. A broken `score()` costs the run its place in the ranking,
// never the alarm that closes it or the reply to a move.
function scoreOf(module: Module | undefined, state: unknown): DailyScore {
  if (!module) return { value: null };
  try {
    return module.score(state);
  } catch (err) {
    console.error("daily score() threw", err);
    return { value: null };
  }
}

export class DailyDO extends DurableObject<Env> {
  // Serializes this object's chart writes, the way `MatchDO` serializes its
  // index writes, so the last write queued is also the last to land.
  private chartQueue: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/run") return this.handleRun(url);
    if (request.method === "POST" && url.pathname === "/start") return this.handleStart(request);
    if (request.method === "POST" && url.pathname === "/action") return this.handleAction(request);
    if (request.method === "POST" && url.pathname === "/finish") return this.handleFinish(request);
    return failure("not_found", 404, "not found");
  }

  // ---------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------

  private readRun(): RunRecord | null {
    const rows = this.ctx.storage.sql
      .exec("SELECT value FROM meta WHERE key = 'run'")
      .toArray() as { value: string }[];
    return rows.length === 0 ? null : (JSON.parse(rows[0].value) as RunRecord);
  }

  private writeRun(record: RunRecord): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO meta (key, value) VALUES ('run', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      JSON.stringify(record),
    );
  }

  private snapshotOf(record: RunRecord): DailyRunSnapshot {
    const module = getDailyGame(record.gameId) as Module | undefined;
    return {
      gameId: record.gameId,
      day: record.day,
      status: record.status,
      view: module ? module.view(record.state) : null,
      score: scoreOf(module, record.state),
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      endsAt: dayEnd(record.day),
    };
  }

  // The run as it stands, which is also what every route that changed it
  // replies with. Read after the save, because the save awaits.
  private currentSnapshot(fallback: RunRecord): DailyRunSnapshot {
    return this.snapshotOf(this.readRun() ?? fallback);
  }

  // ---------------------------------------------------------------------
  // The run's life
  // ---------------------------------------------------------------------

  // Ends the run as it stands. The engine's to do, not the game's: it is how
  // a run ends when its day does, or when its player chooses to stop, and in
  // both cases the score is whatever `score()` says of the state right now.
  private close(record: RunRecord, now: number): void {
    record.status = "done";
    record.finishedAt = Math.min(now, dayEnd(record.day));
  }

  // A run still going once its day is over is closed, whether or not the
  // alarm that closes it has fired yet. Every route checks this before it
  // reads or changes a run, so a late alarm can never let a move land on
  // yesterday's board.
  private overdue(record: RunRecord, now: number): boolean {
    return record.status === "active" && now >= dayEnd(record.day);
  }

  // Persists `record`, then brings the chart and the alarm up to it. The
  // write is synchronous and first, so everything that read the record on
  // the way here did so without an await in between; the two stages after it
  // each re-read the run for themselves.
  private async save(record: RunRecord): Promise<void> {
    this.writeRun(record);
    await this.syncChart();
    await this.reconcileAlarm();
  }

  // Queued like `MatchDO.syncIndex()`: each write reads the run only once
  // its own turn comes, so whichever lands last carries the latest truth.
  // Never throws, and never fails the move that called it — the chart is
  // derived, and a write that fails is retried from the alarm (see
  // `reconcileAlarm()`).
  private async syncChart(): Promise<void> {
    const task = this.chartQueue.then(() => this.writeChartNow());
    this.chartQueue = task.catch(() => {});
    await task;
  }

  private async writeChartNow(): Promise<void> {
    const record = this.readRun();
    if (!record || record.charted === record.status) return;
    const module = getDailyGame(record.gameId) as Module | undefined;
    const score = record.status === "done" ? scoreOf(module, record.state) : null;
    try {
      await this.env.DB.prepare(
        `INSERT INTO daily_runs (game_id, day, player_id, status, score, detail, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(game_id, day, player_id) DO UPDATE SET
           status = excluded.status,
           score = excluded.score,
           detail = excluded.detail,
           finished_at = excluded.finished_at`,
      )
        .bind(
          record.gameId,
          record.day,
          record.playerId,
          record.status,
          score?.value ?? null,
          score?.detail ? JSON.stringify(score.detail) : null,
          record.startedAt,
          record.finishedAt,
        )
        .run();
    } catch (err) {
      console.error("daily chart write failed", err);
      return;
    }
    // Re-read: the run can have ended while that write was in flight. The
    // row then says what the run *was*, which is exactly what `charted`
    // records, and the write queued behind this one brings it up to date.
    const current = this.readRun();
    if (!current) return;
    current.charted = record.status;
    this.writeRun(current);
  }

  // The alarm has two jobs: closing a run when its day ends, and retrying a
  // chart write D1 refused. A run that is over and charted needs neither.
  private async reconcileAlarm(): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    // Decided after the await, from the run as it is now.
    const record = this.readRun();
    if (!record) return;
    const wakeAt =
      record.status === "active"
        ? dayEnd(record.day)
        : record.charted !== record.status
          ? Date.now() + CHART_RETRY_MS
          : null;
    if (wakeAt !== null) {
      if (existing !== wakeAt) await this.ctx.storage.setAlarm(wakeAt);
    } else if (existing !== null) {
      await this.ctx.storage.deleteAlarm();
    }
  }

  // ---------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------

  // The caller's run, closing it first if its day is already over, or the
  // refusal to show it to anyone else.
  private async settled(
    record: RunRecord,
    playerId: PlayerId,
  ): Promise<DailyRunSnapshot | Response> {
    if (record.playerId !== playerId) {
      return failure("not_a_player", 403, "this run belongs to someone else");
    }
    const now = Date.now();
    if (this.overdue(record, now)) {
      this.close(record, now);
      await this.save(record);
    }
    return this.currentSnapshot(record);
  }

  private replyWith(run: DailyRunSnapshot | Response): Response {
    return run instanceof Response ? run : Response.json(run);
  }

  private async handleRun(url: URL): Promise<Response> {
    const playerId = url.searchParams.get("playerId");
    if (!playerId) return failure("missing_player", 400, "missing playerId");
    const record = this.readRun();
    if (!record) return Response.json({ run: null });
    const run = await this.settled(record, playerId);
    return run instanceof Response ? run : Response.json({ run });
  }

  // Starts the run, or hands back the one already here: a second start is
  // how "one run a day" is enforced, not an error.
  private async handleStart(request: Request): Promise<Response> {
    const parsed = StartBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return failure("invalid_body", 400, "invalid body");
    const { gameId, day, playerId } = parsed.data;

    const existing = this.readRun();
    if (existing) return this.replyWith(await this.settled(existing, playerId));

    const module = getDailyGame(gameId) as Module | undefined;
    if (!module) return failure("unknown_game", 404, "unknown daily game");
    if (!isDay(day)) return failure("invalid_body", 400, "not a day");
    const now = Date.now();
    if (now >= dayEnd(day)) return failure("day_over", 409, "that day is over");
    if (now < dayStart(day)) return failure("not_today", 409, "that day has not begun");
    if (!this.env.SESSION_SECRET) {
      return failure("missing_binding", 500, "missing SESSION_SECRET binding");
    }

    const seed = await daySeed(this.env.SESSION_SECRET, gameId, day);
    // A second start can land during that await — a double tap, or the same
    // player on a second device. Whichever made the run first made the run.
    const raced = this.readRun();
    if (raced) return this.replyWith(await this.settled(raced, playerId));

    const record: RunRecord = {
      gameId,
      day,
      playerId,
      status: "active",
      state: module.init(seed, now),
      startedAt: now,
      finishedAt: null,
      charted: null,
    };
    if (module.finished(record.state)) this.close(record, now);
    await this.save(record);
    return Response.json(this.currentSnapshot(record));
  }

  private async handleAction(request: Request): Promise<Response> {
    const parsed = ActionBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return failure("invalid_body", 400, "invalid body");
    const { playerId, action } = parsed.data;

    const record = this.readRun();
    if (!record) return failure("no_run", 404, "no run started");
    if (record.playerId !== playerId) {
      return failure("not_a_player", 403, "this run belongs to someone else");
    }
    const module = getDailyGame(record.gameId) as Module | undefined;
    if (!module) return failure("unknown_game", 404, "unknown daily game");
    const parsedAction = module.actionSchema.safeParse(action);
    if (!parsedAction.success) return failure("invalid_action", 400, "invalid action payload");

    const now = Date.now();
    if (this.overdue(record, now)) {
      this.close(record, now);
      await this.save(record);
      return failure("day_over", 409, "that day is over");
    }
    if (record.status === "done") return failure("run_over", 409, "the run is over");

    let next: unknown;
    try {
      next = module.reduce(record.state, parsedAction.data, now);
    } catch (err) {
      // The persisted run is left exactly as it was: nothing is saved.
      return failure("invalid_move", 400, err instanceof Error ? err.message : "rules violation");
    }
    record.state = next;
    if (module.finished(next)) this.close(record, now);
    await this.save(record);
    return Response.json(this.currentSnapshot(record));
  }

  // Ends the run now, as it stands, and puts it on the chart. Ending one that
  // is already over is a success: the caller's intent holds either way.
  private async handleFinish(request: Request): Promise<Response> {
    const parsed = ActorBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return failure("invalid_body", 400, "invalid body");
    const record = this.readRun();
    if (!record) return failure("no_run", 404, "no run started");
    if (record.playerId !== parsed.data.playerId) {
      return failure("not_a_player", 403, "this run belongs to someone else");
    }
    if (record.status === "active") {
      this.close(record, Date.now());
      await this.save(record);
    }
    return Response.json(this.currentSnapshot(record));
  }

  // Closes a run whose day has ended, and retries a chart write that failed.
  // Like `MatchDO.alarm()`, it must never throw: a throw is retried up to six
  // times for nothing, since everything here is safe to run again anyway.
  async alarm(): Promise<void> {
    try {
      const record = this.readRun();
      if (!record) return;
      const now = Date.now();
      if (record.status === "active" && !this.overdue(record, now)) {
        // Early fire: the day is not over yet.
        await this.ctx.storage.setAlarm(dayEnd(record.day));
        return;
      }
      if (this.overdue(record, now)) this.close(record, now);
      await this.save(record);
    } catch (err) {
      console.error("daily alarm failed", err);
    }
  }
}
