import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { beforeEach, describe, expect, it } from "vitest";

import { NicknameTakenError, findPlayerById, playerStats, renamePlayer, signIn } from "./players";

// The registry's whole job is "one nickname, one player", and the thing
// that actually enforces it is a SQL unique index — so this runs the real
// statements against the real migrations, on node's built-in sqlite, rather
// than a hand-written stand-in that would happily agree with the code.

// Enough of the D1 binding for worker/players.ts: prepare().bind().first()
// and .run(). D1 rejects on a constraint violation, which is the branch
// every write in players.ts is built around, so the mock must too.
function createDb(): D1Database {
  const db = new DatabaseSync(":memory:");
  // `migrations/*.sql` in order, exactly as `wrangler d1 migrations apply`
  // would — the unique index and the columns under test come from them.
  for (const file of [
    "migrations/0001_init.sql",
    "migrations/0002_match_index_columns.sql",
    "migrations/0003_players_and_results.sql",
  ]) {
    db.exec(readFileSync(file, "utf8"));
  }

  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            first<T>(): Promise<T | null> {
              return Promise.resolve((db.prepare(sql).get(...args) as T) ?? null);
            },
            run() {
              // Synchronous throws become rejections, which is how the real
              // binding reports a constraint violation.
              try {
                return Promise.resolve({ meta: db.prepare(sql).run(...args) });
              } catch (err) {
                return Promise.reject(err);
              }
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

// Seeds the match index directly. These rows are derived state in
// production (MatchDO.writeIndexNow writes them); the registry only ever
// reads them.
function seedMatch(
  db: D1Database,
  matchId: string,
  status: string,
  players: { id: string; won: 0 | 1 }[],
) {
  return Promise.all([
    db
      .prepare(
        "INSERT INTO matches (id, game_id, status, created_at, updated_at) VALUES (?, 'tictactoe', ?, 0, 0)",
      )
      .bind(matchId, status)
      .run(),
    ...players.map((p) =>
      db
        .prepare(
          "INSERT INTO match_players (match_id, player_id, waiting, nickname, won) VALUES (?, ?, 0, 'x', ?)",
        )
        .bind(matchId, p.id, p.won)
        .run(),
    ),
  ]);
}

describe("signIn", () => {
  let db: D1Database;
  beforeEach(() => {
    db = createDb();
  });

  it("mints a player the first time a nickname is claimed", async () => {
    const ada = await signIn(db, "Ada");
    expect(ada.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(ada.nickname).toBe("Ada");
  });

  it("returns the same player for the same nickname, which is what makes a second device work", async () => {
    const first = await signIn(db, "Ada");
    const second = await signIn(db, "Ada");
    expect(second.id).toBe(first.id);
  });

  it.each(["ada", "ADA", "  Ada  "])("treats %j as the same nickname as 'Ada'", async (typed) => {
    const first = await signIn(db, "Ada");
    expect((await signIn(db, typed)).id).toBe(first.id);
  });

  it("gives a different nickname a different player", async () => {
    const ada = await signIn(db, "Ada");
    const grace = await signIn(db, "Grace");
    expect(grace.id).not.toBe(ada.id);
  });

  it("adopts the spelling last used", async () => {
    await signIn(db, "ada");
    expect((await signIn(db, "Ada")).nickname).toBe("Ada");
    expect((await findPlayerById(db, (await signIn(db, "Ada")).id))?.nickname).toBe("Ada");
  });
});

describe("renamePlayer", () => {
  let db: D1Database;
  beforeEach(() => {
    db = createDb();
  });

  it("keeps the player id, so nothing they have played is left behind", async () => {
    const ada = await signIn(db, "Ada");
    const renamed = await renamePlayer(db, ada.id, "Countess");
    expect(renamed.id).toBe(ada.id);
    expect(renamed.nickname).toBe("Countess");
  });

  it("frees the old nickname for someone else", async () => {
    const ada = await signIn(db, "Ada");
    await renamePlayer(db, ada.id, "Countess");
    const newcomer = await signIn(db, "Ada");
    expect(newcomer.id).not.toBe(ada.id);
  });

  it("refuses a nickname another player holds", async () => {
    const ada = await signIn(db, "Ada");
    await signIn(db, "Grace");
    await expect(renamePlayer(db, ada.id, "Grace")).rejects.toBeInstanceOf(NicknameTakenError);
    // And leaves the would-be renamer exactly as they were.
    expect((await findPlayerById(db, ada.id))?.nickname).toBe("Ada");
  });

  it("refuses a nickname another player holds under a different spelling", async () => {
    const ada = await signIn(db, "Ada");
    await signIn(db, "Grace");
    await expect(renamePlayer(db, ada.id, "  GRACE ")).rejects.toBeInstanceOf(NicknameTakenError);
  });

  it("lets a player restyle their own nickname", async () => {
    const ada = await signIn(db, "ada");
    expect((await renamePlayer(db, ada.id, "Ada")).id).toBe(ada.id);
  });

  it("gives a session older than the registry a row rather than a second identity", async () => {
    const renamed = await renamePlayer(db, "pre-registry-uuid", "Ada");
    expect(renamed.id).toBe("pre-registry-uuid");
    expect((await signIn(db, "Ada")).id).toBe("pre-registry-uuid");
  });
});

describe("playerStats", () => {
  let db: D1Database;
  beforeEach(() => {
    db = createDb();
  });

  it("is all zeroes for a player who has played nothing", async () => {
    expect(await playerStats(db, "ada")).toEqual({ played: 0, finished: 0, won: 0 });
  });

  it("counts matches in flight as played but not finished", async () => {
    await seedMatch(db, "M1", "active", [{ id: "ada", won: 0 }]);
    expect(await playerStats(db, "ada")).toEqual({ played: 1, finished: 0, won: 0 });
  });

  it("counts a finished match, and the win in it", async () => {
    await seedMatch(db, "M1", "done", [
      { id: "ada", won: 1 },
      { id: "grace", won: 0 },
    ]);
    await seedMatch(db, "M2", "done", [
      { id: "ada", won: 0 },
      { id: "grace", won: 1 },
    ]);
    expect(await playerStats(db, "ada")).toEqual({ played: 2, finished: 2, won: 1 });
    expect(await playerStats(db, "grace")).toEqual({ played: 2, finished: 2, won: 1 });
  });

  it("follows the player id, not the nickname — so a rename keeps the record", async () => {
    const ada = await signIn(db, "Ada");
    await seedMatch(db, "M1", "done", [{ id: ada.id, won: 1 }]);
    await renamePlayer(db, ada.id, "Countess");
    expect(await playerStats(db, ada.id)).toEqual({ played: 1, finished: 1, won: 1 });
  });
});
