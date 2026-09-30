import { readdirSync } from "node:fs";

import { beforeEach, describe, expect, it } from "vitest";

import { createMigratedDb } from "./__fixtures__/d1";
import { PREVIEW_COPY, dailyPreview, matchPreview, previewFor, previewLanguage } from "./preview";

const DAY = "2026-09-21";
const NOON = Date.parse(`${DAY}T12:00:00Z`);

let db: D1Database;

beforeEach(async () => {
  db = createMigratedDb();
  for (const [id, name] of [
    ["ada", "Ada"],
    ["bob", "Bob"],
  ]) {
    await db
      .prepare(
        "INSERT INTO players (id, nickname, nickname_key, created_at, last_seen_at) VALUES (?, ?, ?, 0, 0)",
      )
      .bind(id, name, name.toLowerCase())
      .run();
  }
});

async function addMatch(code: string, status: string, players: string[], gameId = "connect4") {
  await db
    .prepare(
      "INSERT INTO matches (id, game_id, status, created_at, updated_at, host_id) VALUES (?, ?, ?, 0, 0, ?)",
    )
    .bind(code, gameId, status, players[0] ?? null)
    .run();
  for (const id of players) {
    await db
      .prepare("INSERT INTO match_players (match_id, player_id, waiting) VALUES (?, ?, 0)")
      .bind(code, id)
      .run();
  }
}

async function addRun(gameId: string, playerId: string, score: number | null, status = "done") {
  await db
    .prepare(
      `INSERT INTO daily_runs (game_id, day, player_id, status, score, detail, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, NULL, 0, ?)`,
    )
    .bind(gameId, DAY, playerId, status, score, status === "done" ? 1 : null)
    .run();
}

describe("previewLanguage", () => {
  it("takes the sharer's language from the link first", () => {
    expect(previewLanguage("it", "en-US,en;q=0.9")).toBe("it");
  });

  it("falls back to the first language the crawler accepts that the app speaks", () => {
    expect(previewLanguage(null, "fr-FR, it-IT;q=0.8, en;q=0.5")).toBe("it");
    expect(previewLanguage(null, "en;q=0.4, it;q=0.9")).toBe("it");
    expect(previewLanguage(null, "it;q=0, en")).toBe("en");
  });

  it("ends at English, whatever it is given", () => {
    expect(previewLanguage("xx", null)).toBe("en");
    expect(previewLanguage(null, "fr")).toBe("en");
    expect(previewLanguage(null, "")).toBe("en");
  });

  // A language the app speaks but this table does not would get English
  // previews for links its speakers share. Nothing else links the two sets.
  it("covers every language web/locales ships", () => {
    const languages = readdirSync("web/locales")
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.replace(/\.json$/, ""));
    expect(Object.keys(PREVIEW_COPY).sort()).toEqual(languages.sort());
  });
});

describe("matchPreview", () => {
  it("names the host and the game of a lobby, and the seats still open", async () => {
    await addMatch("ABCDEF", "lobby", ["ada"]);
    expect(await matchPreview(db, "abcdef", "en")).toEqual({
      title: "Ada invited you to play Connect 4",
      description: "1 seat left. Tap to join before it fills up.",
    });
  });

  it("says so when the lobby is full", async () => {
    await addMatch("ABCDEF", "lobby", ["ada", "bob"]);
    expect((await matchPreview(db, "ABCDEF", "en"))?.description).toBe(
      "The lobby is full, and the match is about to start.",
    );
  });

  it("names who is playing a match under way, host first", async () => {
    await addMatch("ABCDEF", "active", ["bob", "ada"]);
    expect(await matchPreview(db, "ABCDEF", "en")).toEqual({
      title: "Connect 4 on Pimpom",
      description: "Bob and Ada are playing.",
    });
  });

  it("writes in the language asked for, game name included", async () => {
    await addMatch("ABCDEF", "lobby", ["ada"]);
    expect(await matchPreview(db, "ABCDEF", "it")).toEqual({
      title: "Ada ti invita a giocare a Forza 4",
      description: "Resta 1 posto. Tocca per entrare prima che si riempia.",
    });
  });

  it("has nothing to say about a code that is not a match", async () => {
    await addMatch("ABCDEF", "lobby", ["ada"], "no-such-game");
    expect(await matchPreview(db, "ABCDEF", "en")).toBeNull();
    expect(await matchPreview(db, "GHJKLM", "en")).toBeNull();
    expect(await matchPreview(db, "not a code", "en")).toBeNull();
  });
});

describe("dailyPreview", () => {
  const invitation = {
    title: "Today's 2048 on Pimpom",
    description: "The same board for everyone, one run each. How far can you get?",
  };

  it("invites to today's board when the link names no run", async () => {
    expect(await dailyPreview(db, "2048", { from: null, day: null }, "en", NOON)).toEqual(
      invitation,
    );
  });

  it("puts the challenger's score and rank in a challenge link's preview", async () => {
    await addRun("2048", "ada", 2048);
    await addRun("2048", "bob", 4096);
    expect(await dailyPreview(db, "2048", { from: "ada", day: DAY }, "en", NOON)).toEqual({
      title: "Ada scored 2,048 at 2048. Can you beat it?",
      description:
        "#2 of 2 on the chart for Monday, September 21. The same board for everyone, one run each. Your turn.",
    });
  });

  it("reads a time as a stopwatch does", async () => {
    await addRun("sudoku", "ada", 65_000);
    const preview = await dailyPreview(db, "sudoku", { from: "ada", day: DAY }, "it", NOON);
    expect(preview?.title).toBe("Ada ha fatto 1:05 a Sudoku. Riesci a batterlo?");
    expect(preview?.description).toMatch(/^1º su 1 nella classifica di lunedì 21 settembre\./);
  });

  it("names the challenger of a run still going, without a score", async () => {
    await addRun("2048", "ada", null, "active");
    expect(await dailyPreview(db, "2048", { from: "ada", day: DAY }, "en", NOON)).toEqual({
      title: "Ada challenges you to 2048",
      description: invitation.description,
    });
  });

  it("falls back to the invitation for a run it cannot find or a day not yet begun", async () => {
    await addRun("2048", "ada", 2048);
    expect(await dailyPreview(db, "2048", { from: "cy", day: DAY }, "en", NOON)).toEqual(
      invitation,
    );
    expect(await dailyPreview(db, "2048", { from: "ada", day: "2026-09-22" }, "en", NOON)).toEqual(
      invitation,
    );
    expect(await dailyPreview(db, "2048", { from: "ada", day: "yesterday" }, "en", NOON)).toEqual(
      invitation,
    );
  });

  it("has nothing to say about a game that is not a daily one", async () => {
    expect(await dailyPreview(db, "connect4", { from: null, day: null }, "en", NOON)).toBeNull();
  });
});

describe("previewFor", () => {
  it("picks the preview by path, and the language from the link", async () => {
    await addMatch("ABCDEF", "lobby", ["ada"]);
    const preview = await previewFor(db, new URL("https://x.test/m/ABCDEF?lang=it"), "en");
    expect(preview?.title).toBe("Ada ti invita a giocare a Forza 4");
    expect((await previewFor(db, new URL("https://x.test/daily/2048/"), null))?.title).toBe(
      "Today's 2048 on Pimpom",
    );
    expect(await previewFor(db, new URL("https://x.test/daily/2048/extra"), null)).toBeNull();
  });

  it("never throws: a failed read only costs the preview", async () => {
    const broken = {
      prepare() {
        throw new Error("D1 is down");
      },
    } as unknown as D1Database;
    const quiet = console.error;
    console.error = () => {};
    try {
      expect(await previewFor(broken, new URL("https://x.test/m/ABCDEF"), null)).toBeNull();
    } finally {
      console.error = quiet;
    }
  });
});
