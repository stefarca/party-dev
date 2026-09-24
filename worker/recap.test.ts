import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import { createMigratedDb } from "./__fixtures__/d1";
import {
  RECAP_CRON,
  composeRecap,
  gatherRecap,
  isQuietWeek,
  recapDuration,
  sendWeeklyRecap,
} from "./recap";
import type { RecapData } from "./recap";

// The recap is read from the index like every other stat, so it runs on the
// real migrations, seeded the way the Durable Objects write them. The message
// itself is pinned whole: it is the product, and a change to it should be a
// change someone meant.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Monday 2026-09-21, when the cron fires: the recap covers 14–20 September.
const NOW = Date.UTC(2026, 8, 21, 8);
const at = (day: number, hour = 12) => Date.UTC(2026, 8, day, hour);
const BASE_URL = "https://pimpom.test";
const HOOK = "http://slack.test/hook";

async function seedPlayer(db: D1Database, id: string, nickname: string) {
  await db
    .prepare(
      "INSERT INTO players (id, nickname, nickname_key, created_at, last_seen_at) VALUES (?, ?, ?, 0, 0)",
    )
    .bind(id, nickname, nickname.toLowerCase())
    .run();
}

async function seedMatch(
  db: D1Database,
  id: string,
  gameId: string,
  status: string,
  finishedAt: number,
  players: Record<string, { won?: boolean; waiting?: boolean }>,
) {
  await db
    .prepare(
      "INSERT INTO matches (id, game_id, status, created_at, updated_at, result_kind) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id, gameId, status, finishedAt - HOUR, finishedAt, status === "done" ? "win" : null)
    .run();
  for (const [playerId, { won = false, waiting = false }] of Object.entries(players)) {
    await db
      .prepare("INSERT INTO match_players (match_id, player_id, waiting, won) VALUES (?, ?, ?, ?)")
      .bind(id, playerId, waiting ? 1 : 0, won ? 1 : 0)
      .run();
  }
}

const beat = (
  db: D1Database,
  id: string,
  winner: string,
  loser: string,
  when: number,
  gameId = "connect4",
) => seedMatch(db, id, gameId, "done", when, { [winner]: { won: true }, [loser]: {} });

async function seedWait(
  db: D1Database,
  matchId: string,
  playerId: string,
  startedAt: number,
  endedAt: number | null,
) {
  await db
    .prepare(
      "INSERT INTO turn_waits (match_id, player_id, started_at, ended_at, moved) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(matchId, playerId, startedAt, endedAt, endedAt === null ? null : 1)
    .run();
}

async function seedDaily(
  db: D1Database,
  gameId: string,
  day: string,
  playerId: string,
  score: number,
) {
  await db
    .prepare(
      "INSERT INTO daily_runs (game_id, day, player_id, status, score, started_at) VALUES (?, ?, ?, 'done', ?, 0)",
    )
    .bind(gameId, day, playerId, score)
    .run();
}

// A week with something in every section.
async function busyWeek(db: D1Database) {
  await seedPlayer(db, "ada", "Ada");
  await seedPlayer(db, "bob", "Bob");
  await seedPlayer(db, "cy", "Cy");

  // Bob takes the first, then Ada wins three in a row.
  await beat(db, "M1", "bob", "ada", at(14));
  await beat(db, "M2", "ada", "bob", at(15));
  await beat(db, "M3", "ada", "bob", at(16));
  await beat(db, "M4", "ada", "cy", at(17), "tictactoe");
  // A match stuck on Bob since before the week began.
  await seedMatch(db, "STUCK", "checkers", "active", at(10), {
    ada: {},
    bob: { waiting: true },
  });
  await seedWait(db, "STUCK", "bob", at(10), null);

  // Ada moves every day of the week, quickly.
  for (let day = 14; day <= 20; day++)
    await seedWait(db, "M9", "ada", at(day), at(day) + 10 * MINUTE);
  // Cy takes an hour, once.
  await seedWait(db, "M4", "cy", at(17, 9), at(17, 10));

  // Cy tops 2048 twice; Ada tops Sudoku once, where lower is better.
  await seedDaily(db, "2048", "2026-09-15", "cy", 4096);
  await seedDaily(db, "2048", "2026-09-15", "ada", 1024);
  await seedDaily(db, "2048", "2026-09-16", "cy", 2048);
  await seedDaily(db, "sudoku", "2026-09-16", "ada", 300_000);
  await seedDaily(db, "sudoku", "2026-09-16", "cy", 400_000);
}

describe("gatherRecap", () => {
  it("reads the week before the Monday it runs on", async () => {
    const db = createMigratedDb();
    await busyWeek(db);
    const data = await gatherRecap(db, NOW);

    expect(data).toMatchObject({
      week: "2026-09-14",
      from: at(14, 0),
      to: at(21, 0),
      matches: 4,
      moves: 8,
      players: 2,
      dailyRuns: 5,
    });
    expect(data.champions.map((c) => [c.nickname, c.won, c.finished])).toEqual([
      ["Ada", 3, 4],
      ["Bob", 1, 3],
    ]);
    expect(data.onFire).toEqual([{ playerId: "ada", nickname: "Ada", streak: 3 }]);
    expect(data.rivalry).toEqual({
      a: { playerId: "ada", nickname: "Ada" },
      b: { playerId: "bob", nickname: "Bob" },
      aWins: 2,
      bWins: 1,
      draws: 0,
      gameIds: ["connect4"],
    });
    expect(data.dailyChamps).toEqual([{ playerId: "cy", nickname: "Cy", tops: 2 }]);
    expect(data.playStreaks).toEqual([{ playerId: "ada", nickname: "Ada", days: 7 }]);
    expect(data.quickest).toEqual({
      playerId: "ada",
      nickname: "Ada",
      medianMs: 10 * MINUTE,
      moves: 7,
    });
    expect(data.shame.map((e) => [e.nickname, e.waitedMs])).toEqual([
      ["Bob", 7 * DAY],
      ["Ada", 70 * MINUTE],
      ["Cy", HOUR],
    ]);
    expect(data.stalled).toEqual([
      {
        slow: { playerId: "bob", nickname: "Bob" },
        waiting: [{ playerId: "ada", nickname: "Ada" }],
        gameId: "checkers",
        since: at(10),
      },
    ]);
  });

  it("is quiet when nothing happened and nothing is stuck", async () => {
    const db = createMigratedDb();
    await seedPlayer(db, "ada", "Ada");
    await beat(db, "OLD", "ada", "bob", at(3));
    expect(isQuietWeek(await gatherRecap(db, NOW))).toBe(true);

    // A match stuck all week is exactly what the recap is for.
    await seedMatch(db, "STUCK", "connect4", "active", at(1), { ada: {}, bob: { waiting: true } });
    await seedWait(db, "STUCK", "bob", at(1), null);
    expect(isQuietWeek(await gatherRecap(db, NOW))).toBe(false);
  });
});

describe("composeRecap", () => {
  it("says who won, who is on a roll and who kept everyone waiting", async () => {
    const db = createMigratedDb();
    await busyWeek(db);
    const text = composeRecap(await gatherRecap(db, NOW), BASE_URL, NOW);

    expect(text.split("\n")).toEqual([
      "📊 *Pimpom weekly recap* · Sep 14 – Sep 20",
      "4 matches finished, 8 moves and 5 daily runs, from 2 players.",
      "",
      expect.stringMatching(/^🏆 \*Champion of the week:\* \*Ada\*, 3 wins from 4 matches\. \S/),
      expect.stringMatching(/^🔥 \*On fire:\* \*Ada\* has won 3 in a row\. \S/),
      expect.stringMatching(
        /^⚔️ \*Rivalry of the week:\* \*Ada\* vs \*Bob\*, 2–1 at Connect 4\. \S/,
      ),
      "📅 *Daily champ:* *Cy* topped 2 daily charts.",
      "📆 *Streaks:* Ada 7 days. Don't break them now.",
      "⚡ *Quickest on the draw:* *Ada*, typically back in 10m.",
      "",
      "🐌 *Wall of shame*: who kept everyone waiting longest",
      "1. Bob: 7d over 1 turn (longest 10d 20h)",
      "2. Ada: 1h 10m over 7 turns (longest 10m)",
      "3. Cy: 1h over 1 turn (longest 1h)",
      expect.stringContaining("*Bob*"),
      "",
      "⏳ *Still waiting*",
      "• Ada has been waiting on *Bob* at Checkers for 10d 20h.",
      expect.any(String),
      "",
      "<https://pimpom.test|Make your move →>",
    ]);
  });

  it("picks the same jabs for the same week, and others for another", async () => {
    const db = createMigratedDb();
    await busyWeek(db);
    const data = await gatherRecap(db, NOW);
    const nextWeek: RecapData = { ...data, week: "2026-09-21", from: data.from + 7 * DAY };
    expect(composeRecap(data, BASE_URL, NOW)).toBe(composeRecap(data, BASE_URL, NOW));
    expect(composeRecap(nextWeek, BASE_URL, NOW)).not.toBe(composeRecap(data, BASE_URL, NOW));
  });

  it("escapes a nickname Slack would read as markup", async () => {
    const db = createMigratedDb();
    await seedPlayer(db, "mal", "<!channel> & co");
    await seedPlayer(db, "bob", "Bob");
    await beat(db, "M1", "mal", "bob", at(15));

    const text = composeRecap(await gatherRecap(db, NOW), BASE_URL, NOW);
    expect(text).toContain("*&lt;!channel&gt; &amp; co*, 1 win from 1 match.");
    expect(text).not.toContain("<!channel>");
  });

  it("owns up to a week nobody moved in", async () => {
    const db = createMigratedDb();
    await seedMatch(db, "STUCK", "connect4", "active", at(1), { ada: {}, bob: { waiting: true } });
    await seedWait(db, "STUCK", "bob", at(1), null);
    const text = composeRecap(await gatherRecap(db, NOW), BASE_URL, NOW);
    expect(text.split("\n")[1]).toBe("Not a single move all week. The boards miss you.");
  });
});

describe("recapDuration", () => {
  it("says a duration in its two largest units", () => {
    expect(recapDuration(3 * DAY + 4 * HOUR + 5 * MINUTE)).toBe("3d 4h");
    expect(recapDuration(2 * DAY)).toBe("2d");
    expect(recapDuration(5 * HOUR + 12 * MINUTE)).toBe("5h 12m");
    expect(recapDuration(3 * HOUR)).toBe("3h");
    expect(recapDuration(14 * MINUTE + 59_000)).toBe("14m");
    expect(recapDuration(30_000)).toBe("under a minute");
  });
});

describe("sendWeeklyRecap", () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  async function busyEnv(webhook: string | null = HOOK) {
    const db = createMigratedDb();
    await busyWeek(db);
    return {
      DB: db,
      SLACK_WEBHOOK_URL: webhook ?? undefined,
      PUBLIC_BASE_URL: BASE_URL,
    } as unknown as Env;
  }

  const posts = () => fetchSpy.mock.calls.filter(([url]) => url === HOOK);

  it("posts the week once, however many times it runs", async () => {
    const env = await busyEnv();
    expect(await sendWeeklyRecap(env, NOW)).toBe("sent");
    expect(await sendWeeklyRecap(env, NOW + HOUR)).toBe("already_sent");

    expect(posts()).toHaveLength(1);
    const body = JSON.parse(String(posts()[0][1]?.body)) as { text: string };
    expect(body.text).toMatch(/^📊 \*Pimpom weekly recap\* · Sep 14 – Sep 20/);
  });

  it("gives the week back when Slack refuses it, so a later run can try again", async () => {
    const env = await busyEnv();
    fetchSpy.mockResolvedValueOnce(new Response("no", { status: 500 }));
    expect(await sendWeeklyRecap(env, NOW)).toBe("failed");
    expect(await sendWeeklyRecap(env, NOW)).toBe("sent");
    expect(posts()).toHaveLength(2);
  });

  it("does nothing without a webhook", async () => {
    const env = await busyEnv(null);
    expect(await sendWeeklyRecap(env, NOW)).toBe("not_configured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stays silent about a week with nothing in it, and claims nothing", async () => {
    const env = {
      DB: createMigratedDb(),
      SLACK_WEBHOOK_URL: HOOK,
      PUBLIC_BASE_URL: BASE_URL,
    } as unknown as Env;
    expect(await sendWeeklyRecap(env, NOW)).toBe("quiet");
    expect(fetchSpy).not.toHaveBeenCalled();
    const claimed = await env.DB.prepare("SELECT COUNT(*) AS n FROM recaps")
      .bind()
      .first<{ n: number }>();
    expect(claimed?.n).toBe(0);
  });
});

describe("RECAP_CRON", () => {
  // scheduled() tells the recap from the lobby sweep by this exact string.
  it("is one of the crons wrangler.jsonc schedules", () => {
    const config = readFileSync("wrangler.jsonc", "utf8");
    const crons = config.match(/"crons":\s*\[([^\]]*)\]/)?.[1] ?? "";
    expect(crons).toContain(`"${RECAP_CRON}"`);
  });
});
