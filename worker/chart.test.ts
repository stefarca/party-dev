import { beforeEach, describe, expect, test } from "vitest";

import type { DailyGameMeta } from "../games/catalog";
import { UNKNOWN_NICKNAME } from "../shared/nickname";
import { createMigratedDb } from "./__fixtures__/d1";
import { dailyChart, dailySummaries } from "./chart";

const DAY = "2026-09-21";

const points: DailyGameMeta = { id: "points", name: "Points", order: "desc", format: "number" };
const race: DailyGameMeta = { id: "race", name: "Race", order: "asc", format: "duration" };

let db: D1Database;

beforeEach(() => {
  db = createMigratedDb();
});

async function addPlayer(id: string, nickname: string) {
  await db
    .prepare(
      "INSERT INTO players (id, nickname, nickname_key, created_at, last_seen_at) VALUES (?, ?, ?, 0, 0)",
    )
    .bind(id, nickname, nickname.toLowerCase())
    .run();
}

async function addRun(
  gameId: string,
  playerId: string,
  run: { status?: string; score?: number | null; finishedAt?: number; day?: string },
) {
  const status = run.status ?? "done";
  await db
    .prepare(
      `INSERT INTO daily_runs (game_id, day, player_id, status, score, detail, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    )
    .bind(
      gameId,
      run.day ?? DAY,
      playerId,
      status,
      run.score ?? null,
      status === "done" ? JSON.stringify({ key: "chart.detail", values: { count: 3 } }) : null,
      status === "done" ? (run.finishedAt ?? 1) : null,
    )
    .run();
}

describe("dailyChart", () => {
  beforeEach(async () => {
    for (const [id, name] of [
      ["ada", "Ada"],
      ["bob", "Bob"],
      ["cy", "Cy"],
      ["di", "Di"],
      ["ed", "Ed"],
    ]) {
      await addPlayer(id, name);
    }
  });

  test("ranks the finished runs best first, sharing a rank on a tie", async () => {
    await addRun("points", "ada", { score: 900, finishedAt: 5 });
    await addRun("points", "bob", { score: 1200, finishedAt: 9 });
    await addRun("points", "cy", { score: 900, finishedAt: 2 });
    await addRun("points", "di", { score: 300 });

    const chart = await dailyChart(db, points, DAY, "ada");
    expect(chart.entries.map((e) => [e.nickname, e.score, e.rank])).toEqual([
      ["Bob", 1200, 1],
      // A tie is listed in the order its runs finished, and ranked together.
      ["Cy", 900, 2],
      ["Ada", 900, 2],
      ["Di", 300, 4],
    ]);
    expect(chart.entries[0].detail).toEqual({ key: "chart.detail", values: { count: 3 } });
  });

  test("ranks the smallest first for a game that wants it", async () => {
    await addRun("race", "ada", { score: 61_000 });
    await addRun("race", "bob", { score: 45_000 });

    const chart = await dailyChart(db, race, DAY, "ada");
    expect(chart.entries.map((e) => [e.nickname, e.rank])).toEqual([
      ["Bob", 1],
      ["Ada", 2],
    ]);
  });

  test("lists a run with no score after every ranked one, unranked", async () => {
    await addRun("race", "ada", { score: null });
    await addRun("race", "bob", { score: 45_000 });

    const chart = await dailyChart(db, race, DAY, "ada");
    expect(chart.entries.map((e) => [e.nickname, e.rank])).toEqual([
      ["Bob", 1],
      ["Ada", null],
    ]);
  });

  test("counts runs still going, without listing them", async () => {
    await addRun("points", "ada", { score: 10 });
    await addRun("points", "bob", { status: "active" });
    await addRun("points", "cy", { status: "active" });

    const chart = await dailyChart(db, points, DAY, "bob");
    expect(chart.entries.map((e) => e.nickname)).toEqual(["Ada"]);
    expect(chart).toMatchObject({ finished: 1, playing: 2 });
    expect(chart.mine).toMatchObject({ playerId: "bob", status: "active", rank: null });
  });

  test("reports the caller's own run even when it is past the listed page", async () => {
    await addRun("points", "ada", { score: 50 });
    await addRun("points", "bob", { score: 40 });
    await addRun("points", "cy", { score: 40 });
    await addRun("points", "di", { score: 10 });

    const chart = await dailyChart(db, points, DAY, "di", 2);
    expect(chart.entries.map((e) => e.nickname)).toEqual(["Ada", "Bob"]);
    expect(chart.mine).toMatchObject({ nickname: "Di", score: 10, rank: 4 });
    expect(chart.finished).toBe(4);
  });

  test("keeps days and games apart", async () => {
    await addRun("points", "ada", { score: 50 });
    await addRun("points", "bob", { score: 70, day: "2026-09-20" });
    await addRun("race", "cy", { score: 1 });

    const chart = await dailyChart(db, points, DAY, "bob");
    expect(chart.entries.map((e) => e.nickname)).toEqual(["Ada"]);
    expect(chart.mine).toBeNull();
  });

  test("names each run from the registry, and a missing name as unknown", async () => {
    await addRun("points", "ghost", { score: 5 });
    await db.prepare("UPDATE players SET nickname = 'Adelaide' WHERE id = 'ada'").bind().run();
    await addRun("points", "ada", { score: 6 });

    const chart = await dailyChart(db, points, DAY, "ada");
    expect(chart.entries.map((e) => e.nickname)).toEqual(["Adelaide", UNKNOWN_NICKNAME]);
  });
});

describe("dailySummaries", () => {
  test("gives every daily game the caller's run, the count and the leader", async () => {
    await addPlayer("ada", "Ada");
    await addPlayer("bob", "Bob");
    await addRun("2048", "ada", { score: 2000 });
    await addRun("2048", "bob", { score: 1500 });

    const [game] = await dailySummaries(db, DAY, "bob");
    expect(game).toEqual({
      gameId: "2048",
      mine: { status: "done", score: 1500, rank: 2 },
      finished: 2,
      leader: { playerId: "ada", nickname: "Ada", score: 2000 },
    });

    const [fresh] = await dailySummaries(db, "2026-09-22", "bob");
    expect(fresh).toEqual({ gameId: "2048", mine: null, finished: 0, leader: null });
  });
});
