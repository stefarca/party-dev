import { beforeEach, describe, expect, it } from "vitest";

import { UNKNOWN_NICKNAME } from "../shared/nickname";
import { createMigratedDb } from "./__fixtures__/d1";
import {
  champions,
  gameRecords,
  median,
  playDaysOfEveryone,
  playStreak,
  playerStreaks,
  replyTimes,
  rivals,
  wallOfShame,
  winStreak,
  winStreaksOfEveryone,
} from "./stats";

// What counts is decided in SQL — which waits overlap a window, who beat whom
// at a table of four, which matches a reset leaves out — so the queries run
// against the real migrations, seeded the way the Durable Objects write them.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 8, 14, 12); // midday on Monday 2026-09-14

async function seedPlayer(db: D1Database, id: string, nickname = id, statsSince?: number) {
  await db
    .prepare(
      "INSERT INTO players (id, nickname, nickname_key, created_at, last_seen_at, stats_since) VALUES (?, ?, ?, 0, 0, ?)",
    )
    .bind(id, nickname, nickname.toLowerCase(), statsSince ?? null)
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
    players,
  }: SeedMatch,
) {
  await db
    .prepare(
      "INSERT INTO matches (id, game_id, status, created_at, updated_at, result_kind) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id, gameId, status, createdAt, finishedAt, status === "done" ? resultKind : null)
    .run();
  for (const [playerId, won] of Object.entries(players)) {
    await db
      .prepare("INSERT INTO match_players (match_id, player_id, waiting, won) VALUES (?, ?, 0, ?)")
      .bind(id, playerId, won ? 1 : 0)
      .run();
  }
}

// A win for `winner` over `loser`, finished at `at`.
function beat(db: D1Database, id: string, winner: string, loser: string, at = T0, gameId?: string) {
  return seedMatch(db, { id, gameId, finishedAt: at, players: { [winner]: true, [loser]: false } });
}

async function seedWait(
  db: D1Database,
  matchId: string,
  playerId: string,
  startedAt: number,
  endedAt: number | null,
  moved = true,
) {
  await db
    .prepare(
      "INSERT INTO turn_waits (match_id, player_id, started_at, ended_at, moved) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(matchId, playerId, startedAt, endedAt, endedAt === null ? null : moved ? 1 : 0)
    .run();
}

async function seedDailyRun(db: D1Database, playerId: string, day: string, gameId = "2048") {
  await db
    .prepare(
      "INSERT INTO daily_runs (game_id, day, player_id, status, started_at) VALUES (?, ?, ?, 'done', 0)",
    )
    .bind(gameId, day, playerId)
    .run();
}

describe("playStreak", () => {
  it("counts the days in a row up to today", () => {
    expect(playStreak(["2026-09-12", "2026-09-13", "2026-09-14"], "2026-09-14")).toEqual({
      current: 3,
      best: 3,
      today: true,
    });
  });

  it("keeps a streak that reached yesterday alive, and says today is still to play", () => {
    expect(playStreak(["2026-09-12", "2026-09-13"], "2026-09-14")).toEqual({
      current: 2,
      best: 2,
      today: false,
    });
  });

  it("drops a streak with a whole day missed, but remembers the best one", () => {
    const days = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-12"];
    expect(playStreak(days, "2026-09-14")).toEqual({ current: 0, best: 4, today: false });
  });

  it("reads days in any order and with repeats, across a month's end", () => {
    const days = ["2026-10-01", "2026-09-30", "2026-10-01", "2026-09-29"];
    expect(playStreak(days, "2026-10-01")).toEqual({ current: 3, best: 3, today: true });
  });

  it("is nothing for a player who never played", () => {
    expect(playStreak([], "2026-09-14")).toEqual({ current: 0, best: 0, today: false });
  });
});

describe("winStreak", () => {
  it("counts wins in a row, oldest first, and keeps the best", () => {
    expect(winStreak([true, true, true, false, true, true])).toEqual({ current: 2, best: 3 });
    expect(winStreak([true, false])).toEqual({ current: 0, best: 1 });
    expect(winStreak([])).toEqual({ current: 0, best: 0 });
  });
});

describe("median", () => {
  it("takes the middle value, or the mean of the middle two", () => {
    expect(median([1, 5, 100])).toBe(5);
    expect(median([1, 4, 6, 100])).toBe(5);
    expect(median([])).toBeNull();
  });
});

describe("stats queries", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = createMigratedDb();
    for (const id of ["ada", "bob", "cy", "dee"]) await seedPlayer(db, id, id.toUpperCase());
  });

  describe("playerStreaks", () => {
    it("counts a day with a move in a match or a daily run, by UTC day", async () => {
      // A move one minute before midnight UTC counts for that day, not the next.
      await seedWait(db, "M1", "ada", T0 - 2 * DAY, Date.UTC(2026, 8, 12, 23, 59));
      await seedDailyRun(db, "ada", "2026-09-13");
      await seedWait(db, "M1", "ada", T0 - HOUR, T0);

      const { play } = await playerStreaks(db, "ada", T0);
      expect(play).toEqual({ current: 3, best: 3, today: true });
    });

    it("does not count a turn that ended without the player moving", async () => {
      await seedWait(db, "M1", "ada", T0 - HOUR, T0, false);
      expect((await playerStreaks(db, "ada", T0)).play.current).toBe(0);
    });

    it("counts wins in a row in the order the matches finished", async () => {
      await beat(db, "M3", "ada", "bob", T0 + 3);
      await beat(db, "M1", "ada", "bob", T0 + 1);
      await beat(db, "M2", "bob", "ada", T0 + 2);
      await beat(db, "M4", "ada", "cy", T0 + 4);

      expect((await playerStreaks(db, "ada", T0)).wins).toEqual({ current: 2, best: 2 });
    });

    it("skips matches with no recorded result, and unfinished ones", async () => {
      await beat(db, "M1", "ada", "bob", T0 + 1);
      await seedMatch(db, {
        id: "OLD",
        finishedAt: T0 + 2,
        resultKind: null,
        players: { ada: false, bob: false },
      });
      await seedMatch(db, {
        id: "LIVE",
        status: "active",
        finishedAt: T0 + 3,
        players: { ada: false, bob: false },
      });
      await beat(db, "M2", "ada", "bob", T0 + 4);

      expect((await playerStreaks(db, "ada", T0)).wins).toEqual({ current: 2, best: 2 });
    });

    it("starts the win streak over at a reset, but not the play streak", async () => {
      await seedPlayer(db, "eve", "Eve", T0);
      await beat(db, "M1", "eve", "bob", T0 + 1);
      await seedMatch(db, {
        id: "M2",
        createdAt: T0 + 2,
        finishedAt: T0 + 3,
        players: { eve: true, bob: false },
      });
      await seedMatch(db, {
        id: "M0",
        createdAt: T0 - DAY,
        finishedAt: T0 + 4,
        players: { eve: true, bob: false },
      });
      await seedWait(db, "M1", "eve", T0 - DAY - HOUR, T0 - DAY);
      await seedWait(db, "M2", "eve", T0, T0 + HOUR);

      const streaks = await playerStreaks(db, "eve", T0);
      expect(streaks.wins).toEqual({ current: 1, best: 1 });
      expect(streaks.play.current).toBe(2);
    });
  });

  describe("gameRecords", () => {
    it("breaks the record down by game, most-played first", async () => {
      await beat(db, "M1", "ada", "bob", T0, "tictactoe");
      await beat(db, "M2", "bob", "ada", T0, "connect4");
      await beat(db, "M3", "ada", "bob", T0, "connect4");
      await seedMatch(db, { id: "M4", status: "active", players: { ada: false, bob: false } });

      expect(await gameRecords(db, "ada")).toEqual([
        { gameId: "connect4", played: 3, finished: 2, won: 1 },
        { gameId: "tictactoe", played: 1, finished: 1, won: 1 },
      ]);
    });
  });

  describe("rivals", () => {
    it("tallies each opponent's wins, losses and draws, game by game", async () => {
      await beat(db, "M1", "ada", "bob", T0, "connect4");
      await beat(db, "M2", "bob", "ada", T0, "connect4");
      await beat(db, "M3", "bob", "ada", T0, "connect4");
      await beat(db, "M4", "ada", "bob", T0, "tictactoe");
      await seedMatch(db, {
        id: "M5",
        gameId: "tictactoe",
        resultKind: "draw",
        players: { ada: false, bob: false },
      });
      await beat(db, "M6", "ada", "cy", T0);

      const [bob, cy] = await rivals(db, "ada");
      expect(bob).toEqual({
        playerId: "bob",
        nickname: "BOB",
        played: 5,
        wins: 2,
        losses: 2,
        draws: 1,
        games: [
          { gameId: "connect4", played: 3, wins: 1, losses: 2, draws: 0 },
          { gameId: "tictactoe", played: 2, wins: 1, losses: 0, draws: 1 },
        ],
      });
      expect(cy).toMatchObject({ playerId: "cy", played: 1, wins: 1, losses: 0, draws: 0 });
    });

    it("pairs everyone at a bigger table, with a shared top score a draw between its holders", async () => {
      await seedMatch(db, {
        id: "T1",
        gameId: "trivia",
        resultKind: "scores",
        players: { ada: true, bob: true, cy: false, dee: false },
      });

      const byId = Object.fromEntries((await rivals(db, "ada")).map((r) => [r.playerId, r]));
      expect(byId.bob).toMatchObject({ wins: 0, losses: 0, draws: 1 });
      expect(byId.cy).toMatchObject({ wins: 1, losses: 0, draws: 0 });
      expect(byId.dee).toMatchObject({ wins: 1, losses: 0, draws: 0 });
      expect((await rivals(db, "cy")).find((r) => r.playerId === "dee")).toMatchObject({
        draws: 1,
      });
    });

    it("counts only the viewer's matches since their reset, and names a player the registry lost", async () => {
      await seedPlayer(db, "eve", "Eve", T0);
      await seedMatch(db, { id: "M1", createdAt: T0 - DAY, players: { eve: false, ghost: true } });
      await seedMatch(db, { id: "M2", createdAt: T0 + 1, players: { eve: true, ghost: false } });

      expect(await rivals(db, "eve")).toEqual([
        expect.objectContaining({ nickname: UNKNOWN_NICKNAME, played: 1, wins: 1, losses: 0 }),
      ]);
    });
  });

  describe("replyTimes", () => {
    it("takes the median of the moves in the window, and nothing else", async () => {
      await seedWait(db, "M1", "ada", T0 - 2 * HOUR, T0 - HOUR); // 1h
      await seedWait(db, "M1", "ada", T0 - 3 * HOUR, T0 - HOUR + 1); // 2h and 1ms
      await seedWait(db, "M1", "ada", T0 - 10 * DAY, T0 - HOUR); // days, but still the middle one out
      await seedWait(db, "M1", "ada", T0 - 5 * HOUR, T0, false); // not a move
      await seedWait(db, "M1", "ada", T0 - 40 * DAY, T0 - 39 * DAY); // before the window
      await seedWait(db, "M1", "ada", T0, null); // still open

      expect(await replyTimes(db, "ada", T0)).toEqual({
        days: 30,
        moves: 3,
        medianMs: 2 * HOUR + 1,
      });
    });
  });

  describe("wallOfShame", () => {
    const from = T0 - 7 * DAY;
    const to = T0;

    it("adds up only the part of each wait inside the window", async () => {
      await seedWait(db, "M1", "ada", from - DAY, from + HOUR); // 1h inside
      await seedWait(db, "M2", "ada", to - HOUR, to + DAY); // 1h inside
      await seedWait(db, "M3", "bob", from + DAY, from + DAY + 30 * 60 * 1000);
      await seedWait(db, "M4", "cy", from - 3 * DAY, from - 2 * DAY); // before the window

      expect(await wallOfShame(db, from, to, to + 2 * DAY)).toEqual([
        {
          playerId: "ada",
          nickname: "ADA",
          waitedMs: 2 * HOUR,
          turns: 2,
          longestMs: DAY + HOUR,
          stalled: 0,
        },
        {
          playerId: "bob",
          nickname: "BOB",
          waitedMs: 30 * 60 * 1000,
          turns: 1,
          longestMs: 30 * 60 * 1000,
          stalled: 0,
        },
      ]);
    });

    it("counts a wait still open up to now, and says how many are stalled", async () => {
      await seedWait(db, "M1", "dee", from - 10 * DAY, null);
      await seedWait(db, "M2", "dee", to - DAY, null);

      const [dee] = await wallOfShame(db, from, to, to - HOUR);
      expect(dee).toMatchObject({ waitedMs: 7 * DAY - HOUR + (DAY - HOUR), turns: 2, stalled: 2 });
      expect(dee.longestMs).toBe(17 * DAY - HOUR);
    });

    it("lists the slowest first, at most `limit` of them", async () => {
      await seedWait(db, "M1", "ada", from, from + HOUR);
      await seedWait(db, "M2", "bob", from, from + 3 * HOUR);
      await seedWait(db, "M3", "cy", from, from + 2 * HOUR);

      const board = await wallOfShame(db, from, to, to, 2);
      expect(board.map((e) => e.playerId)).toEqual(["bob", "cy"]);
    });
  });

  describe("champions", () => {
    it("ranks the week's wins, the fewest matches first on a tie", async () => {
      const from = T0 - 7 * DAY;
      await beat(db, "M1", "ada", "bob", from + 1);
      await beat(db, "M2", "ada", "cy", from + 2);
      await beat(db, "M3", "bob", "cy", from + 3);
      await beat(db, "M4", "bob", "dee", from + 4);
      await beat(db, "M5", "cy", "bob", from + 5);
      await beat(db, "OLD", "dee", "ada", from - 1); // the week before

      expect(await champions(db, from, T0)).toEqual([
        { playerId: "ada", nickname: "ADA", won: 2, finished: 2 },
        { playerId: "bob", nickname: "BOB", won: 2, finished: 4 },
        { playerId: "cy", nickname: "CY", won: 1, finished: 3 },
      ]);
    });
  });

  describe("everyone's streaks, for the recap", () => {
    it("reads every player's play days and win streak at once", async () => {
      await seedWait(db, "M1", "ada", T0 - HOUR, T0);
      await seedDailyRun(db, "bob", "2026-09-13");
      await seedDailyRun(db, "bob", "2026-09-01"); // before the lower bound
      await beat(db, "M2", "ada", "bob", T0 + 1);
      await beat(db, "M3", "ada", "bob", T0 + 2);

      const days = await playDaysOfEveryone(db, "2026-09-10");
      expect(Object.fromEntries(days)).toEqual({ ada: ["2026-09-14"], bob: ["2026-09-13"] });

      const streaks = await winStreaksOfEveryone(db);
      expect(streaks.get("ada")).toEqual({ current: 2, best: 2 });
      expect(streaks.get("bob")).toEqual({ current: 0, best: 0 });
    });
  });
});
