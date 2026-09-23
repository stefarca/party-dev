import { beforeEach, describe, expect, it } from "vitest";

import { createMigratedDb } from "./__fixtures__/d1";
import { SWEEP_BATCH, SWEEP_MIN_AGE_MS, sweepLobbies } from "./sweep";

const NOW = Date.UTC(2026, 8, 23, 12);
const OLD = NOW - SWEEP_MIN_AGE_MS - 1;

// Stands in for the MATCH namespace: each DO answers the sweep with whatever
// `replies` says for its match, and records that it was asked.
function createMatchNamespace(replies: Record<string, number | Error>) {
  const swept: string[] = [];
  const namespace = {
    idFromName: (name: string) => name,
    get: (id: string) => ({
      async fetch(url: string, init: RequestInit) {
        expect(url).toBe("http://do/lobby/sweep");
        expect(init.method).toBe("POST");
        swept.push(id);
        const reply = replies[id] ?? 200;
        if (reply instanceof Error) throw reply;
        return new Response(null, { status: reply });
      },
    }),
  };
  return { namespace, swept };
}

async function seedMatch(db: D1Database, id: string, createdAt: number, status = "lobby") {
  await db
    .prepare(
      "INSERT INTO matches (id, game_id, status, created_at, updated_at) VALUES (?, 'tictactoe', ?, ?, ?)",
    )
    .bind(id, status, createdAt, createdAt)
    .run();
  await db
    .prepare("INSERT INTO match_players (match_id, player_id, waiting) VALUES (?, 'p1', 0)")
    .bind(id)
    .run();
}

async function indexedIds(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT id FROM matches ORDER BY id")
    .bind()
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

describe("sweepLobbies", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createMigratedDb();
  });

  it("asks only lobbies older than a day, and leaves started matches alone", async () => {
    await seedMatch(db, "OLDLOB", OLD);
    await seedMatch(db, "NEWLOB", NOW - 1000);
    await seedMatch(db, "ACTIVE", OLD, "active");
    await seedMatch(db, "DONE01", OLD, "done");
    const { namespace, swept } = createMatchNamespace({});

    const report = await sweepLobbies({ DB: db, MATCH: namespace } as unknown as Env, NOW);

    expect(swept).toEqual(["OLDLOB"]);
    expect(report).toEqual({ armed: 1, orphaned: 0, failed: 0 });
    expect(await indexedIds(db)).toEqual(["ACTIVE", "DONE01", "NEWLOB", "OLDLOB"]);
  });

  it("drops the index rows of a lobby whose Durable Object holds no match", async () => {
    await seedMatch(db, "GHOST1", OLD);
    await seedMatch(db, "REAL01", OLD);
    const { namespace } = createMatchNamespace({ GHOST1: 404 });

    const report = await sweepLobbies({ DB: db, MATCH: namespace } as unknown as Env, NOW);

    expect(report).toEqual({ armed: 1, orphaned: 1, failed: 0 });
    expect(await indexedIds(db)).toEqual(["REAL01"]);
    const { results } = await db
      .prepare("SELECT match_id FROM match_players")
      .bind()
      .all<{ match_id: string }>();
    expect(results).toEqual([{ match_id: "REAL01" }]);
  });

  it("carries on past a lobby that fails, and keeps its rows", async () => {
    await seedMatch(db, "BROKEN", OLD - 2);
    await seedMatch(db, "ERRORS", OLD - 1);
    await seedMatch(db, "FINE01", OLD);
    const { namespace, swept } = createMatchNamespace({
      BROKEN: new Error("DO unreachable"),
      ERRORS: 500,
    });

    const report = await sweepLobbies({ DB: db, MATCH: namespace } as unknown as Env, NOW);

    expect(swept).toEqual(["BROKEN", "ERRORS", "FINE01"]);
    expect(report).toEqual({ armed: 1, orphaned: 0, failed: 2 });
    expect(await indexedIds(db)).toEqual(["BROKEN", "ERRORS", "FINE01"]);
  });

  it("takes the oldest lobbies first, a batch at a time", async () => {
    for (let i = 0; i < SWEEP_BATCH + 5; i++) {
      await seedMatch(db, `L${String(i).padStart(5, "0")}`, OLD - (SWEEP_BATCH + 5 - i));
    }
    const { namespace, swept } = createMatchNamespace({});

    await sweepLobbies({ DB: db, MATCH: namespace } as unknown as Env, NOW);

    expect(swept).toHaveLength(SWEEP_BATCH);
    expect(swept[0]).toBe("L00000");
    expect(swept.at(-1)).toBe(`L${String(SWEEP_BATCH - 1).padStart(5, "0")}`);
  });
});
