import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { DailyRunSnapshot } from "../shared/protocol";
import { createMigratedDb } from "./__fixtures__/d1";

// "cloudflare:workers" only exists inside workerd; stub the base class
// `daily.ts` extends, the same way worker/match.test.ts does.
vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { diceGame, ROLLS } = await import("../games/__fixtures__/dice");
const { dailyGames } = await import("../games/registry");
const { CHART_RETRY_MS, DailyDO, daySeed, runName } = await import("./daily");

const DAY = "2026-09-21";
const MIDDAY = Date.UTC(2026, 8, 21, 12);
const MIDNIGHT = Date.UTC(2026, 8, 22);

// The D1 binding, over the real schema, with a switch that makes every chart
// write fail the way an unreachable D1 would.
function createChartDb() {
  const db = createMigratedDb();
  const control = { failWrites: false };
  const binding = {
    prepare(sql: string) {
      const statement = db.prepare(sql);
      return {
        bind(...args: unknown[]) {
          const bound = statement.bind(...args);
          return {
            first: () => bound.first(),
            all: () => bound.all(),
            run: () =>
              control.failWrites && /INSERT INTO daily_runs/.test(sql)
                ? Promise.reject(new Error("D1 unavailable"))
                : bound.run(),
          };
        },
      };
    },
  } as unknown as D1Database;
  return { binding, db, control };
}

interface ChartRow {
  status: string;
  score: number | null;
  detail: string | null;
  finished_at: number | null;
}

// The slice of `DurableObjectState` DailyDO touches: SQL storage on
// node:sqlite, and an alarm a test can read back.
function createFakeCtx() {
  const db = new DatabaseSync(":memory:");
  const alarm = { at: null as number | null };
  const sql = {
    exec(sqlText: string, ...params: unknown[]) {
      const statement = db.prepare(sqlText);
      const isSelect = /^\s*select/i.test(sqlText);
      const rows = isSelect ? statement.all(...params) : [];
      if (!isSelect) statement.run(...params);
      return { toArray: () => rows, one: () => rows[0] };
    },
  };
  const ctx = {
    storage: {
      sql,
      getAlarm: async () => alarm.at,
      setAlarm: async (at: number) => {
        alarm.at = at;
      },
      deleteAlarm: async () => {
        alarm.at = null;
      },
    },
  } as unknown as DurableObjectState;
  return { ctx, alarm };
}

// One DailyDO per run name, the way `idFromName` hands them out, all sharing
// one D1 so the chart sees every run.
function createWorld({ secret = "test-secret" } = {}) {
  const chart = createChartDb();
  const env = { DB: chart.binding, SESSION_SECRET: secret } as unknown as Env;
  const runs = new Map<string, ReturnType<typeof createRun>>();

  function createRun() {
    const { ctx, alarm } = createFakeCtx();
    const run = new DailyDO(ctx, env);
    const post = (path: string, body: unknown) =>
      run.fetch(
        new Request(`http://do${path}`, {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }),
      );
    return {
      alarm,
      run,
      start: (playerId: string, { gameId = "dice", day = DAY } = {}) =>
        post("/start", { gameId, day, playerId }),
      act: (playerId: string, action: unknown) => post("/action", { playerId, action }),
      finish: (playerId: string) => post("/finish", { playerId }),
      read: (playerId: string) =>
        run.fetch(new Request(`http://do/run?playerId=${encodeURIComponent(playerId)}`)),
    };
  }

  // The run object for `playerId` on `day`, created on first use.
  function runOf(playerId: string, { gameId = "dice", day = DAY } = {}) {
    const name = runName(gameId, day, playerId);
    let entry = runs.get(name);
    if (!entry) {
      entry = createRun();
      runs.set(name, entry);
    }
    return entry;
  }

  async function chartRow(playerId: string, day = DAY): Promise<ChartRow | null> {
    return chart.binding
      .prepare(
        "SELECT status, score, detail, finished_at FROM daily_runs WHERE game_id = 'dice' AND day = ? AND player_id = ?",
      )
      .bind(day, playerId)
      .first<ChartRow>();
  }

  return { chart, runOf, chartRow };
}

async function snapshot(res: Response): Promise<DailyRunSnapshot> {
  expect(res.status).toBe(200);
  return (await res.json()) as DailyRunSnapshot;
}

async function errorOf(res: Response): Promise<{ status: number; error: string }> {
  const body = (await res.json()) as { error: string };
  return { status: res.status, error: body.error };
}

const roll = { t: "roll" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MIDDAY);
  dailyGames.dice = diceGame;
});

afterEach(() => {
  delete dailyGames.dice;
  vi.useRealTimers();
});

describe("starting a run", () => {
  test("deals the day's board, charts the run as under way and arms the day's end", async () => {
    const world = createWorld();
    const alice = world.runOf("alice");

    const run = await snapshot(await alice.start("alice"));
    expect(run).toMatchObject({
      gameId: "dice",
      day: DAY,
      status: "active",
      startedAt: MIDDAY,
      finishedAt: null,
      endsAt: MIDNIGHT,
    });
    expect(run.view).toEqual({ opening: expect.any(Number), rolls: [], total: 0 });
    expect(JSON.stringify(run)).not.toContain("rng");
    expect(await world.chartRow("alice")).toMatchObject({ status: "active", score: null });
    expect(alice.alarm.at).toBe(MIDNIGHT);
  });

  test("a second start hands back the same run, however far it has got", async () => {
    const world = createWorld();
    const alice = world.runOf("alice");
    await alice.start("alice");
    const played = await snapshot(await alice.act("alice", roll));

    const again = await snapshot(await alice.start("alice"));
    expect(again.view).toEqual(played.view);
    expect(again.startedAt).toBe(MIDDAY);
  });

  test("everyone gets the same board on the same day, and a new one the next day", async () => {
    const world = createWorld();
    const alice = await snapshot(await world.runOf("alice").start("alice"));
    const bob = await snapshot(await world.runOf("bob").start("bob"));
    expect(bob.view).toEqual(alice.view);

    vi.setSystemTime(MIDNIGHT + 60_000);
    const tomorrow = "2026-09-22";
    const next = await snapshot(
      await world.runOf("alice", { day: tomorrow }).start("alice", { day: tomorrow }),
    );
    expect((next.view as { opening: number }).opening).not.toBe(
      (alice.view as { opening: number }).opening,
    );
  });

  test("the day's seed depends on the secret, the game and the day", async () => {
    const seed = await daySeed("secret", "dice", DAY);
    expect(await daySeed("secret", "dice", DAY)).toBe(seed);
    expect(await daySeed("other secret", "dice", DAY)).not.toBe(seed);
    expect(await daySeed("secret", "2048", DAY)).not.toBe(seed);
    expect(await daySeed("secret", "dice", "2026-09-22")).not.toBe(seed);
  });

  test("only on the day itself", async () => {
    const world = createWorld();
    expect(await errorOf(await world.runOf("alice").start("alice", { day: "2026-09-20" }))).toEqual(
      { status: 409, error: "day_over" },
    );
    expect(await errorOf(await world.runOf("alice").start("alice", { day: "2026-09-22" }))).toEqual(
      { status: 409, error: "not_today" },
    );
    expect(await errorOf(await world.runOf("alice").start("alice", { day: "2026-02-30" }))).toEqual(
      { status: 400, error: "invalid_body" },
    );
  });

  test("an unknown game is refused", async () => {
    const world = createWorld();
    expect(
      await errorOf(
        await world.runOf("alice", { gameId: "nope" }).start("alice", { gameId: "nope" }),
      ),
    ).toEqual({ status: 404, error: "unknown_game" });
  });
});

describe("playing a run", () => {
  test("each action moves the run on, and the last one puts it on the chart", async () => {
    const world = createWorld();
    const alice = world.runOf("alice");
    await alice.start("alice");

    let run: DailyRunSnapshot | null = null;
    for (let i = 0; i < ROLLS; i++) run = await snapshot(await alice.act("alice", roll));
    const view = run!.view as { rolls: number[]; total: number };
    expect(view.rolls).toHaveLength(ROLLS);
    expect(run).toMatchObject({ status: "done", finishedAt: MIDDAY });
    expect(run!.score).toEqual({
      value: view.total,
      detail: { key: "chart.detail", values: { count: ROLLS } },
    });

    expect(await world.chartRow("alice")).toEqual({
      status: "done",
      score: view.total,
      detail: JSON.stringify({ key: "chart.detail", values: { count: ROLLS } }),
      finished_at: MIDDAY,
    });
    // Over and charted: nothing left for the alarm to do.
    expect(alice.alarm.at).toBeNull();
  });

  test("a finished run takes no more actions", async () => {
    const world = createWorld();
    const alice = world.runOf("alice");
    await alice.start("alice");
    for (let i = 0; i < ROLLS; i++) await alice.act("alice", roll);
    expect(await errorOf(await alice.act("alice", roll))).toEqual({
      status: 409,
      error: "run_over",
    });
  });

  test("a malformed action or an illegal move leaves the run as it was", async () => {
    const world = createWorld();
    const alice = world.runOf("alice");
    const before = await snapshot(await alice.start("alice"));

    expect(await errorOf(await alice.act("alice", { t: "fly" }))).toEqual({
      status: 400,
      error: "invalid_action",
    });
    expect(await errorOf(await alice.act("alice", { t: "cheat" }))).toEqual({
      status: 400,
      error: "invalid_move",
    });
    const after = (await (await alice.read("alice")).json()) as { run: DailyRunSnapshot };
    expect(after.run).toEqual(before);
  });

  test("is only for its own player, and only once started", async () => {
    const world = createWorld();
    const alice = world.runOf("alice");
    expect(await errorOf(await alice.act("alice", roll))).toEqual({
      status: 404,
      error: "no_run",
    });
    expect(await (await alice.read("alice")).json()).toEqual({ run: null });

    await alice.start("alice");
    for (const res of [
      await alice.act("mallory", roll),
      await alice.finish("mallory"),
      await alice.read("mallory"),
      await alice.start("mallory"),
    ]) {
      expect(await errorOf(res)).toEqual({ status: 403, error: "not_a_player" });
    }
  });
});

describe("ending a run", () => {
  test("its player can end it early, as it stands, and ending it again changes nothing", async () => {
    const world = createWorld();
    const alice = world.runOf("alice");
    await alice.start("alice");
    const played = await snapshot(await alice.act("alice", roll));
    const total = (played.view as { total: number }).total;

    vi.setSystemTime(MIDDAY + 5_000);
    const ended = await snapshot(await alice.finish("alice"));
    expect(ended).toMatchObject({ status: "done", finishedAt: MIDDAY + 5_000 });
    expect(ended.score.value).toBe(total);
    expect(await world.chartRow("alice")).toMatchObject({ status: "done", score: total });

    vi.setSystemTime(MIDDAY + 9_000);
    expect(await snapshot(await alice.finish("alice"))).toEqual(ended);
  });

  test("the day's end closes a run still going, as it stands", async () => {
    const world = createWorld();
    const alice = world.runOf("alice");
    await alice.start("alice");
    const played = await snapshot(await alice.act("alice", roll));

    vi.setSystemTime(MIDNIGHT + 250);
    await alice.run.alarm();

    const { run } = (await (await alice.read("alice")).json()) as { run: DailyRunSnapshot };
    expect(run).toMatchObject({ status: "done", finishedAt: MIDNIGHT });
    expect(run.score.value).toBe((played.view as { total: number }).total);
    expect(await world.chartRow("alice")).toMatchObject({ status: "done", finished_at: MIDNIGHT });
    expect(alice.alarm.at).toBeNull();
  });

  test("an alarm that fires early waits for the day's end", async () => {
    const world = createWorld();
    const alice = world.runOf("alice");
    await alice.start("alice");
    alice.alarm.at = null;

    await alice.run.alarm();
    expect(alice.alarm.at).toBe(MIDNIGHT);
    expect(await world.chartRow("alice")).toMatchObject({ status: "active" });
  });

  test("a move after midnight is refused and closes the run, alarm or not", async () => {
    const world = createWorld();
    const alice = world.runOf("alice");
    await alice.start("alice");

    vi.setSystemTime(MIDNIGHT + 1);
    expect(await errorOf(await alice.act("alice", roll))).toEqual({
      status: 409,
      error: "day_over",
    });
    expect(await world.chartRow("alice")).toMatchObject({ status: "done", finished_at: MIDNIGHT });
  });
});

describe("the chart's copy", () => {
  test("a write D1 refuses is retried from the alarm until it lands", async () => {
    const world = createWorld();
    const alice = world.runOf("alice");
    world.chart.control.failWrites = true;
    await alice.start("alice");
    expect(await world.chartRow("alice")).toBeNull();

    await alice.finish("alice");
    expect(alice.alarm.at).toBe(MIDDAY + CHART_RETRY_MS);

    // Still down on the first retry: it tries again later.
    vi.setSystemTime(MIDDAY + CHART_RETRY_MS);
    await alice.run.alarm();
    expect(await world.chartRow("alice")).toBeNull();
    expect(alice.alarm.at).toBe(MIDDAY + 2 * CHART_RETRY_MS);

    world.chart.control.failWrites = false;
    vi.setSystemTime(MIDDAY + 2 * CHART_RETRY_MS);
    await alice.run.alarm();
    expect(await world.chartRow("alice")).toMatchObject({ status: "done", finished_at: MIDDAY });
    expect(alice.alarm.at).toBeNull();
  });

  test("a failed write never fails the move itself", async () => {
    const world = createWorld();
    const alice = world.runOf("alice");
    await alice.start("alice");
    world.chart.control.failWrites = true;
    for (let i = 0; i < ROLLS; i++) await snapshot(await alice.act("alice", roll));
    expect(await world.chartRow("alice")).toMatchObject({ status: "active" });
    expect(alice.alarm.at).toBe(MIDDAY + CHART_RETRY_MS);
  });
});
