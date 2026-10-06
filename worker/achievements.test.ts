import { beforeEach, describe, expect, it } from "vitest";

import { ACHIEVEMENTS } from "../shared/achievements";
import type { AchievementId } from "../shared/achievements";
import type { AchievementProgress } from "../shared/protocol";
import { createMigratedDb } from "./__fixtures__/d1";
import {
  achievementsOf,
  fromCount,
  fromGroups,
  fromRuns,
  markAchievementsSeen,
  playRuns,
  seenAchievements,
} from "./achievements";

// What an achievement measures is decided in SQL as much as in code — which
// matches got under way, who was at the table, whose chart a day's run topped
// — so the queries run against the real migrations, seeded the way the
// Durable Objects write them.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 8, 14, 12); // midday on Monday 2026-09-14
const TODAY = "2026-09-14";

describe("fromCount", () => {
  it("reaches each tier at the time the count got to it, in time order", () => {
    expect(fromCount([30, 10, 20], [1, 2, 5])).toEqual({ value: 3, unlockedAt: [10, 20] });
  });

  it("reaches nothing at zero", () => {
    expect(fromCount([], [1])).toEqual({ value: 0, unlockedAt: [] });
  });
});

describe("fromGroups", () => {
  it("measures the biggest group, and reaches a tier when the first group does", () => {
    // A reaches 2 at time 20, B at 15; only A reaches 3.
    expect(
      fromGroups(
        [
          [10, 20, 40],
          [5, 15],
        ],
        [2, 3, 4],
      ),
    ).toEqual({
      value: 3,
      unlockedAt: [15, 40],
    });
  });
});

describe("playRuns and fromRuns", () => {
  it("breaks a run on a missed day, and reaches a tier on the day the run gets there", () => {
    const steps = playRuns([
      { day: "2026-09-29", at: 1 },
      { day: "2026-09-30", at: 2 },
      { day: "2026-10-01", at: 3 },
      { day: "2026-10-03", at: 4 },
    ]);
    expect(steps.map((s) => s.run)).toEqual([1, 2, 3, 1]);
    expect(fromRuns(steps, [2, 3, 4])).toEqual({ value: 3, unlockedAt: [2, 3] });
  });
});

async function seedPlayer(db: D1Database, id: string, statsSince: number | null = null) {
  await db
    .prepare(
      "INSERT INTO players (id, nickname, nickname_key, created_at, last_seen_at, stats_since) VALUES (?, ?, ?, 0, 0, ?)",
    )
    .bind(id, id.toUpperCase(), id, statsSince)
    .run();
}

interface SeedMatch {
  id: string;
  gameId?: string;
  status?: string;
  createdAt?: number;
  finishedAt?: number;
  // "win" unless given; null is a match that finished before results were indexed.
  resultKind?: string | null;
  hostId?: string;
  visibility?: string | null;
  // Every player in the match, and whether they are among its winners.
  players: Record<string, boolean>;
}

async function seedMatch(
  db: D1Database,
  {
    id,
    gameId = "connect4",
    status = "done",
    createdAt = T0 - DAY,
    finishedAt = T0,
    resultKind = "win",
    hostId,
    visibility = "private",
    players,
  }: SeedMatch,
) {
  await db
    .prepare(
      `INSERT INTO matches (id, game_id, status, created_at, updated_at, host_id, result_kind, visibility)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      gameId,
      status,
      createdAt,
      finishedAt,
      hostId ?? Object.keys(players)[0],
      status === "done" ? resultKind : null,
      visibility,
    )
    .run();
  for (const [playerId, won] of Object.entries(players)) {
    await db
      .prepare("INSERT INTO match_players (match_id, player_id, waiting, won) VALUES (?, ?, 0, ?)")
      .bind(id, playerId, status === "done" && resultKind !== null ? (won ? 1 : 0) : null)
      .run();
  }
}

// A win for `winner` over `loser`, finished at `at`.
function beat(db: D1Database, id: string, winner: string, loser: string, at = T0, gameId?: string) {
  return seedMatch(db, { id, gameId, finishedAt: at, players: { [winner]: true, [loser]: false } });
}

let waitMatch = 0;

async function seedWait(
  db: D1Database,
  playerId: string,
  startedAt: number,
  endedAt: number | null,
  moved = true,
) {
  await db
    .prepare(
      "INSERT INTO turn_waits (match_id, player_id, started_at, ended_at, moved) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(`W${++waitMatch}`, playerId, startedAt, endedAt, endedAt === null ? null : moved ? 1 : 0)
    .run();
}

interface SeedRun {
  playerId: string;
  day: string;
  gameId?: string;
  status?: string;
  score?: number | null;
  finishedAt?: number;
}

async function seedRun(
  db: D1Database,
  { playerId, day, gameId = "2048", status = "done", score = null, finishedAt }: SeedRun,
) {
  const start = Date.parse(`${day}T09:00:00Z`);
  await db
    .prepare(
      `INSERT INTO daily_runs (game_id, day, player_id, status, score, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      gameId,
      day,
      playerId,
      status,
      score,
      start,
      status === "done" ? (finishedAt ?? start + HOUR) : null,
    )
    .run();
}

describe("achievementsOf", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = createMigratedDb();
    for (const id of ["ada", "bob", "cy", "dee"]) await seedPlayer(db, id);
  });

  async function progress(
    playerId = "ada",
    now = T0,
  ): Promise<Map<AchievementId, AchievementProgress>> {
    return new Map((await achievementsOf(db, playerId, now)).map((a) => [a.id, a]));
  }

  it("lists every achievement in catalog order, none of them reached by a newcomer", async () => {
    const list = await achievementsOf(db, "ada", T0);
    expect(list.map((a) => a.id)).toEqual(ACHIEVEMENTS.map((a) => a.id));
    for (const achievement of list) {
      expect(achievement, achievement.id).toMatchObject({ value: 0, unlockedAt: [] });
    }
  });

  it("counts wins and finished matches when they finished, and a draw for both sides", async () => {
    await beat(db, "M1", "ada", "bob", T0 + 1);
    await beat(db, "M2", "bob", "ada", T0 + 2);
    await seedMatch(db, {
      id: "M3",
      finishedAt: T0 + 3,
      resultKind: "draw",
      players: { ada: false, bob: false },
    });
    // Neither a lobby nor a match still under way has finished.
    await seedMatch(db, { id: "LOBBY", status: "lobby", players: { ada: false } });
    await seedMatch(db, { id: "LIVE", status: "active", players: { ada: false, bob: false } });

    const ada = await progress();
    expect(ada.get("winner")).toMatchObject({ value: 1, unlockedAt: [T0 + 1] });
    expect(ada.get("veteran")).toMatchObject({ value: 3, unlockedAt: [] });
    expect(ada.get("stalemate")).toMatchObject({ value: 1, unlockedAt: [T0 + 3] });
    expect((await progress("bob")).get("stalemate")?.unlockedAt).toEqual([T0 + 3]);
  });

  it("keeps the best win streak after it breaks, over matches whose result is known", async () => {
    for (let i = 1; i <= 3; i++) await beat(db, `W${i}`, "ada", "bob", T0 + i);
    // A match that finished before results were indexed neither extends nor breaks it.
    await seedMatch(db, {
      id: "OLD",
      finishedAt: T0 + 4,
      resultKind: null,
      players: { ada: false, bob: false },
    });
    await beat(db, "L1", "bob", "ada", T0 + 5);
    await beat(db, "W4", "ada", "bob", T0 + 6);

    expect((await progress()).get("hotStreak")).toMatchObject({ value: 3, unlockedAt: [T0 + 3] });
  });

  it("takes nothing back when the player resets their record", async () => {
    await beat(db, "M1", "ada", "bob", T0 - DAY);
    await db.prepare("UPDATE players SET stats_since = ? WHERE id = 'ada'").bind(T0).run();

    expect((await progress()).get("winner")?.unlockedAt).toEqual([T0 - DAY]);
  });

  it("counts play days from moves and daily runs, as the play streak does", async () => {
    // Three days in a row — a move, a daily run, a move — then a gap, then one more.
    await seedWait(db, "ada", T0 - 3 * DAY, T0 - 2 * DAY - HOUR);
    await seedRun(db, { playerId: "ada", day: "2026-09-13" });
    await seedWait(db, "ada", T0 - HOUR, T0);
    await seedWait(db, "ada", T0 + HOUR, T0 + 2 * HOUR);
    // A turn that ended without the player moving is not a day played.
    await seedWait(db, "ada", T0 + DAY, T0 + 2 * DAY, false);

    // Reached on the third day, with the first thing done on it.
    expect((await progress()).get("regular")).toMatchObject({ value: 3, unlockedAt: [T0] });
  });

  it("counts different games, finished matches and daily runs alike", async () => {
    await beat(db, "M1", "ada", "bob", T0 + 1, "connect4");
    await beat(db, "M2", "ada", "bob", T0 + 2, "connect4");
    await seedRun(db, {
      playerId: "ada",
      day: "2026-09-15",
      gameId: "sudoku",
      finishedAt: T0 + DAY,
    });
    // A run still going has not finished, and neither has a lobby.
    await seedRun(db, { playerId: "ada", day: "2026-09-15", gameId: "2048", status: "active" });
    await seedMatch(db, {
      id: "LOBBY",
      gameId: "checkers",
      status: "lobby",
      players: { ada: false },
    });
    await beat(db, "M3", "bob", "ada", T0 + 2 * DAY, "tictactoe");

    expect((await progress()).get("explorer")).toMatchObject({
      value: 3,
      unlockedAt: [T0 + 2 * DAY],
    });
  });

  it("counts different opponents, and the most matches against any one of them", async () => {
    await seedMatch(db, {
      id: "TABLE",
      gameId: "trivia",
      finishedAt: T0 + 1,
      players: { ada: true, bob: false, cy: false },
    });
    for (let i = 1; i <= 5; i++) await beat(db, `B${i}`, "bob", "ada", T0 + 10 + i);
    await beat(db, "D1", "ada", "dee", T0 + 20);

    const ada = await progress();
    expect(ada.get("social")).toMatchObject({ value: 3, unlockedAt: [T0 + 1] });
    // Bob: the table, then five more; the fifth match against him is the fourth of those.
    expect(ada.get("rivalry")).toMatchObject({ value: 6, unlockedAt: [T0 + 14] });
  });

  it("counts matches hosted once they got under way, and the public ones apart", async () => {
    await seedMatch(db, {
      id: "H1",
      createdAt: 1,
      hostId: "ada",
      players: { ada: true, bob: false },
    });
    await seedMatch(db, {
      id: "H2",
      status: "active",
      createdAt: 2,
      hostId: "ada",
      visibility: "public",
      players: { ada: false, bob: false },
    });
    await seedMatch(db, {
      id: "H3",
      createdAt: 3,
      hostId: "ada",
      players: { ada: false, cy: false },
    });
    await seedMatch(db, {
      id: "OPEN",
      status: "lobby",
      hostId: "ada",
      visibility: "public",
      players: { ada: false },
    });
    await seedMatch(db, {
      id: "BOBS",
      createdAt: 4,
      hostId: "bob",
      players: { bob: true, ada: false },
    });

    const ada = await progress();
    expect(ada.get("host")).toMatchObject({ value: 3, unlockedAt: [3] });
    expect(ada.get("openHouse")).toMatchObject({ value: 1, unlockedAt: [2] });
  });

  it("counts a move made more than a day after the turn came round", async () => {
    await seedWait(db, "ada", T0, T0 + DAY - 1);
    await seedWait(db, "ada", T0, T0 + 2 * DAY, false);
    await seedWait(db, "ada", T0, null);
    expect((await progress()).get("slowpoke")?.unlockedAt).toEqual([]);

    await seedWait(db, "ada", T0 + HOUR, T0 + HOUR + DAY);
    expect((await progress()).get("slowpoke")?.unlockedAt).toEqual([T0 + HOUR + DAY]);
  });

  it("counts daily runs finished, and the most different ones on a single day", async () => {
    for (const [i, gameId] of ["2048", "sudoku", "minesweeper"].entries()) {
      await seedRun(db, {
        playerId: "ada",
        day: "2026-09-12",
        gameId,
        finishedAt: T0 - 2 * DAY + i,
      });
    }
    await seedRun(db, { playerId: "ada", day: "2026-09-13", gameId: "2048" });
    await seedRun(db, { playerId: "ada", day: "2026-09-14", gameId: "sudoku", status: "active" });

    const ada = await progress();
    expect(ada.get("dailyHabit")).toMatchObject({ value: 4, unlockedAt: [] });
    expect(ada.get("cleanSweep")).toMatchObject({ value: 3, unlockedAt: [T0 - 2 * DAY + 2] });
  });

  describe("topOfTheChart", () => {
    it("tops a final chart by the game's own order, with a tie topping it for both", async () => {
      // 2048 ranks the biggest score first, Lights Out the fewest moves.
      await seedRun(db, { playerId: "ada", day: "2026-09-12", gameId: "2048", score: 900 });
      await seedRun(db, { playerId: "bob", day: "2026-09-12", gameId: "2048", score: 500 });
      await seedRun(db, { playerId: "ada", day: "2026-09-13", gameId: "lightsout", score: 12 });
      await seedRun(db, { playerId: "bob", day: "2026-09-13", gameId: "lightsout", score: 12 });
      await seedRun(db, { playerId: "cy", day: "2026-09-13", gameId: "lightsout", score: 20 });

      const ada = await progress();
      expect(ada.get("topOfTheChart")).toMatchObject({
        value: 2,
        unlockedAt: [Date.UTC(2026, 8, 13)],
      });
      expect((await progress("bob")).get("topOfTheChart")?.value).toBe(1);
      expect((await progress("cy")).get("topOfTheChart")?.value).toBe(0);
    });

    it("waits for the day to end, and for someone else to be ranked", async () => {
      await seedRun(db, { playerId: "ada", day: TODAY, score: 900 });
      await seedRun(db, { playerId: "bob", day: TODAY, score: 500 });
      // Alone on the chart, or beside a run with no score, is no contest.
      await seedRun(db, { playerId: "ada", day: "2026-09-12", score: 100 });
      await seedRun(db, { playerId: "ada", day: "2026-09-11", score: 100 });
      await seedRun(db, { playerId: "bob", day: "2026-09-11", score: null });

      expect((await progress()).get("topOfTheChart")?.value).toBe(0);
      expect((await progress("ada", T0 + DAY)).get("topOfTheChart")).toMatchObject({
        value: 1,
        unlockedAt: [Date.UTC(2026, 8, 15)],
      });
    });
  });
});

describe("seen levels", () => {
  let db: D1Database;
  beforeEach(() => {
    db = createMigratedDb();
  });

  it("records what each player was told, and never lowers it", async () => {
    await markAchievementsSeen(db, "ada", { winner: 2, regular: 1 });
    await markAchievementsSeen(db, "ada", { winner: 1, veteran: 1 });
    await markAchievementsSeen(db, "bob", { winner: 1 });

    expect(await seenAchievements(db, "ada")).toEqual({ winner: 2, regular: 1, veteran: 1 });
    expect(await seenAchievements(db, "bob")).toEqual({ winner: 1 });
    expect(await seenAchievements(db, "cy")).toEqual({});
  });

  it("drops an id the catalog does not know, and caps a level at the achievement's tiers", async () => {
    await markAchievementsSeen(db, "ada", { nonsense: 1, stalemate: 4 });
    expect(await seenAchievements(db, "ada")).toEqual({ stalemate: 1 });
  });
});
