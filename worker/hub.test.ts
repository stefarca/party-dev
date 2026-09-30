import { beforeEach, describe, expect, it } from "vitest";

import { UNKNOWN_NICKNAME } from "../shared/nickname";
import { createMigratedDb } from "./__fixtures__/d1";
import { HUB_LIST_LIMIT, myMatches, openMatches } from "./hub";

// Which lobbies the hub offers to join is decided entirely in SQL — the
// partial index, the seat count, the LIMIT — and so is how each of a
// player's own matches went, so this runs the real queries against the real
// migrations.

interface SeedMatch {
  id: string;
  gameId?: string;
  status?: string;
  visibility?: string | null;
  updatedAt?: number;
  players: string[];
  // Who the match waits on, and, once it is over, how it ended and who won.
  waiting?: string[];
  resultKind?: string | null;
  winners?: string[];
}

// Seeds the match index directly, the way MatchDO.writeIndexNow() would.
// The first player hosts.
async function seedMatch(
  db: D1Database,
  {
    id,
    gameId = "tictactoe",
    status = "lobby",
    visibility = "public",
    updatedAt = 1,
    players,
    waiting = [],
    resultKind = null,
    winners = [],
  }: SeedMatch,
) {
  await db
    .prepare(
      "INSERT INTO matches (id, game_id, status, created_at, updated_at, host_id, visibility, result_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, gameId, status, updatedAt, updatedAt, players[0] ?? null, visibility, resultKind)
    .run();
  for (const playerId of players) {
    await db
      .prepare("INSERT INTO match_players (match_id, player_id, waiting, won) VALUES (?, ?, ?, ?)")
      .bind(id, playerId, waiting.includes(playerId) ? 1 : 0, winners.includes(playerId) ? 1 : 0)
      .run();
  }
}

async function seedPlayer(db: D1Database, id: string, nickname: string) {
  await db
    .prepare(
      "INSERT INTO players (id, nickname, nickname_key, created_at, last_seen_at) VALUES (?, ?, ?, 0, 0)",
    )
    .bind(id, nickname, nickname.toLowerCase())
    .run();
}

const ids = (matches: { id: string }[]) => matches.map((m) => m.id);

describe("openMatches", () => {
  let db: D1Database;
  beforeEach(() => {
    db = createMigratedDb();
  });

  it("lists a public lobby with a free seat, named from the registry", async () => {
    await seedPlayer(db, "ada", "Ada");
    await seedMatch(db, { id: "OPEN01", players: ["ada"] });

    expect(await openMatches(db, "grace")).toEqual([
      {
        id: "OPEN01",
        gameId: "tictactoe",
        status: "lobby",
        players: [{ id: "ada", nickname: "Ada" }],
        hostId: "ada",
        waiting: false,
        updatedAt: 1,
        deadline: null,
        visibility: "public",
        waitingOn: [],
        outcome: null,
      },
    ]);
  });

  it("shows a placeholder for a host the registry has no row for", async () => {
    await seedMatch(db, { id: "OPEN01", players: ["ada"] });
    const [match] = await openMatches(db, "grace");
    expect(match.players).toEqual([{ id: "ada", nickname: UNKNOWN_NICKNAME }]);
  });

  it("leaves out private lobbies, and those indexed before visibility existed", async () => {
    await seedMatch(db, { id: "PRIV01", visibility: "private", players: ["ada"] });
    await seedMatch(db, { id: "OLD001", visibility: null, players: ["ada"] });
    expect(await openMatches(db, "grace")).toEqual([]);
  });

  it("leaves out matches that have started or finished", async () => {
    await seedMatch(db, { id: "LIVE01", status: "active", players: ["ada"] });
    await seedMatch(db, { id: "DONE01", status: "done", players: ["ada"] });
    expect(await openMatches(db, "grace")).toEqual([]);
  });

  it("leaves out a lobby the player is already in", async () => {
    await seedMatch(db, { id: "OPEN01", players: ["ada"] });
    expect(await openMatches(db, "ada")).toEqual([]);
  });

  it("leaves out a full lobby", async () => {
    await seedMatch(db, { id: "FULL01", players: ["ada", "grace"] });
    expect(await openMatches(db, "alan")).toEqual([]);
  });

  it("leaves out a game that cannot be joined: shelved, or not in the registry", async () => {
    await seedMatch(db, { id: "SOON01", gameId: "trivia", players: ["ada"] });
    await seedMatch(db, { id: "GONE01", gameId: "no-such-game", players: ["ada"] });
    expect(await openMatches(db, "grace")).toEqual([]);
  });

  it("lists the newest first", async () => {
    await seedMatch(db, { id: "OLDER1", updatedAt: 1, players: ["ada"] });
    await seedMatch(db, { id: "NEWER1", updatedAt: 2, players: ["alan"] });
    expect(ids(await openMatches(db, "grace"))).toEqual(["NEWER1", "OLDER1"]);
  });

  it("does not let lobbies that filled up and never started crowd out an open one", async () => {
    for (let i = 0; i < HUB_LIST_LIMIT; i++) {
      await seedMatch(db, { id: `FULL${i}`, updatedAt: 100 + i, players: ["ada", "alan"] });
    }
    await seedMatch(db, { id: "OPEN01", updatedAt: 1, players: ["ada"] });
    expect(ids(await openMatches(db, "grace"))).toEqual(["OPEN01"]);
  });

  it(`stops at ${HUB_LIST_LIMIT} lobbies`, async () => {
    for (let i = 0; i <= HUB_LIST_LIMIT; i++) {
      await seedMatch(db, { id: `OPEN${i}`, updatedAt: i, players: ["ada"] });
    }
    const listed = await openMatches(db, "grace");
    expect(listed).toHaveLength(HUB_LIST_LIMIT);
    expect(ids(listed)).not.toContain("OPEN0");
  });
});

describe("myMatches", () => {
  let db: D1Database;
  beforeEach(() => {
    db = createMigratedDb();
  });

  const outcomes = async (playerId: string) =>
    Object.fromEntries((await myMatches(db, playerId)).map((m) => [m.id, m.outcome]));

  it("says how each finished match went for the player asking", async () => {
    const done = { status: "done", players: ["ada", "alan"] };
    await seedMatch(db, { ...done, id: "WIN001", resultKind: "win", winners: ["ada"] });
    await seedMatch(db, { ...done, id: "LOSS01", resultKind: "win", winners: ["alan"] });
    await seedMatch(db, { ...done, id: "DRAW01", resultKind: "draw" });
    await seedMatch(db, { ...done, id: "TIED01", resultKind: "scores", winners: ["ada", "alan"] });
    await seedMatch(db, { ...done, id: "OLD001", resultKind: null });

    expect(await outcomes("ada")).toEqual({
      WIN001: "won",
      LOSS01: "lost",
      DRAW01: "draw",
      TIED01: "won",
      OLD001: null,
    });
    expect((await outcomes("alan")).WIN001).toBe("lost");
  });

  it("has no outcome for a match that is not over", async () => {
    await seedMatch(db, { id: "LIVE01", status: "active", players: ["ada", "alan"] });
    await seedMatch(db, { id: "LOBBY1", status: "lobby", players: ["ada"] });
    expect(await outcomes("ada")).toEqual({ LIVE01: null, LOBBY1: null });
  });

  it("names who the match is waiting on, and whether that is the player asking", async () => {
    await seedPlayer(db, "ada", "Ada");
    await seedPlayer(db, "alan", "Alan");
    await seedMatch(db, {
      id: "LIVE01",
      status: "active",
      players: ["ada", "alan"],
      waiting: ["alan"],
    });

    const [asAda] = await myMatches(db, "ada");
    expect(asAda).toMatchObject({
      players: [
        { id: "ada", nickname: "Ada" },
        { id: "alan", nickname: "Alan" },
      ],
      waitingOn: ["alan"],
      waiting: false,
    });
    const [asAlan] = await myMatches(db, "alan");
    expect(asAlan).toMatchObject({ waitingOn: ["alan"], waiting: true });
  });

  it("lists only the player's own matches, the most recently updated first", async () => {
    await seedMatch(db, { id: "OLDER1", status: "active", updatedAt: 1, players: ["ada"] });
    await seedMatch(db, { id: "NEWER1", status: "done", updatedAt: 2, players: ["ada", "alan"] });
    await seedMatch(db, { id: "OTHERS", status: "active", updatedAt: 3, players: ["alan"] });
    expect(ids(await myMatches(db, "ada"))).toEqual(["NEWER1", "OLDER1"]);
  });
});
