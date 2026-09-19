import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MatchEvent } from "../shared/protocol";

// Same stubs as worker/match.test.ts, and for the same reason: there is no
// @cloudflare/vitest-pool-workers setup here, so `cloudflare:workers` and
// the workerd globals MatchDO's constructor reaches for do not exist under
// plain node.
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

(globalThis as { WebSocketRequestResponsePair?: unknown }).WebSocketRequestResponsePair ??= class {
  constructor(
    public request: string,
    public response: string,
  ) {}
};

const { counterGame } = await import("../games/__fixtures__/counter");
const { tictactoeGame } = await import("../games/tictactoe/game");
const { serverGames } = await import("../games/registry");
const { MatchDO } = await import("./match");

function createCtx(): DurableObjectState {
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec(sqlText: string, ...params: unknown[]) {
      const stmt = db.prepare(sqlText);
      const isSelect = /^\s*select/i.test(sqlText);
      const rows = isSelect ? (stmt.all(...params) as Record<string, unknown>[]) : [];
      if (!isSelect) stmt.run(...params);
      return { toArray: () => rows, one: () => rows[0] };
    },
  };
  let alarm: number | null = null;
  return {
    id: { toString: () => "fake-do-id" },
    storage: {
      sql,
      getAlarm: () => Promise.resolve(alarm),
      setAlarm: (value: number) => {
        alarm = value;
        return Promise.resolve();
      },
      deleteAlarm: () => {
        alarm = null;
        return Promise.resolve();
      },
    },
    // No sockets: this suite is about what the log *stores* and what the
    // HTTP route serves, not about the broadcast.
    getWebSockets: () => [],
    acceptWebSocket: () => {},
    setWebSocketAutoResponse: () => {},
    // `nudgeHook` hands its Slack call to the runtime; nothing here has a
    // webhook configured, so running it inline is enough.
    waitUntil: (promise: Promise<unknown>) => void promise,
  } as unknown as DurableObjectState;
}

// Swallows the index writes; D1 is derived and nothing here reads it. The
// one read is the roster's names, which come from the player registry.
const REGISTRY: Record<string, string> = { alice: "Alice", bob: "Bob" };

function createEnv(): Env {
  return {
    DB: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          sql,
          args,
          all: () =>
            Promise.resolve({
              results: (args as string[])
                .filter((id) => id in REGISTRY)
                .map((id) => ({ id, nickname: REGISTRY[id] })),
            }),
        }),
      }),
      batch: () => Promise.resolve([]),
    },
  } as unknown as Env;
}

function post(path: string, body: unknown): Request {
  return new Request(`http://do${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function startedMatch(gameId: string) {
  const matchDo = new MatchDO(createCtx(), createEnv());
  await matchDo.fetch(
    post("/lobby/create", {
      matchId: "M1",
      gameId,
      hostId: "alice",
    }),
  );
  await matchDo.fetch(post("/lobby/join", { playerId: "bob" }));
  await matchDo.fetch(post("/start", { playerId: "alice" }));
  return matchDo;
}

async function readEvents(
  matchDo: InstanceType<typeof MatchDO>,
  query = "playerId=alice",
): Promise<MatchEvent[]> {
  const res = await matchDo.fetch(new Request(`http://do/events?${query}`));
  expect(res.status).toBe(200);
  return ((await res.json()) as { events: MatchEvent[] }).events;
}

describe("the event log", () => {
  beforeEach(() => {
    // Test-only fixture, deliberately absent from games/registry.ts.
    serverGames.counter = counterGame;
  });
  afterEach(() => {
    delete serverGames.counter;
  });

  // By id only: the history panel names each player from the roster, so a
  // rename relabels the whole log rather than leaving old lines behind.
  it("records who joined and that the match started", async () => {
    const matchDo = await startedMatch("tictactoe");
    expect((await readEvents(matchDo)).map((e) => e.payload)).toEqual([
      { type: "player_joined", id: "alice" },
      { type: "player_joined", id: "bob" },
      { type: "match_started" },
    ]);
  });

  it("stores a game's own description of a move instead of its raw action", async () => {
    const matchDo = await startedMatch("tictactoe");
    const view = (await (
      await matchDo.fetch(new Request("http://do/view?playerId=alice"))
    ).json()) as { waitingOn: string[] };
    const mover = view.waitingOn[0];

    await matchDo.fetch(post("/action", { playerId: mover, action: { t: "place", cell: 4 } }));

    const last = (await readEvents(matchDo)).at(-1);
    expect(last?.payload).toEqual({
      type: "action",
      by: mover,
      describe: {
        key: "history.place",
        // Cell 4 is the middle square: row 2, column 2, 1-indexed the way
        // the board labels itself.
        values: { mark: "X", row: 2, column: 2 },
      },
    });
    // The point of describing rather than logging: the raw action is gone.
    expect(JSON.stringify(last?.payload)).not.toContain("cell");
  });

  it("falls back to the raw action for a game that describes nothing", async () => {
    const matchDo = await startedMatch("counter");
    await matchDo.fetch(post("/action", { playerId: "alice", action: { t: "increment" } }));
    expect((await readEvents(matchDo)).at(-1)?.payload).toEqual({
      type: "action",
      by: "alice",
      action: { t: "increment" },
    });
  });

  it("records the result when the match finishes", async () => {
    const matchDo = await startedMatch("tictactoe");
    // X takes the top row; O answers in the middle row. `players` maps each
    // mark to a player, and which player got X is drawn from the seed, so
    // the movers are read off `waitingOn` rather than assumed.
    for (const cell of [0, 3, 1, 4, 2]) {
      const view = (await (
        await matchDo.fetch(new Request("http://do/view?playerId=alice"))
      ).json()) as { waitingOn: string[] };
      await matchDo.fetch(
        post("/action", { playerId: view.waitingOn[0], action: { t: "place", cell } }),
      );
    }

    const last = (await readEvents(matchDo)).at(-1);
    expect(last?.payload).toMatchObject({ type: "match_finished", result: { kind: "win" } });
  });
});

describe("GET /events", () => {
  it("returns only what is newer than `since`", async () => {
    const matchDo = await startedMatch("tictactoe");
    const all = await readEvents(matchDo);
    const after = await readEvents(matchDo, `playerId=alice&since=${all[0].seq}`);
    expect(after.map((e) => e.seq)).toEqual(all.slice(1).map((e) => e.seq));
  });

  it("returns events oldest-first, so the panel can just reverse them", async () => {
    const events = await readEvents(await startedMatch("tictactoe"));
    expect(events.map((e) => e.seq)).toEqual([...events.map((e) => e.seq)].sort((a, b) => a - b));
  });

  it("is refused for someone who is not in the match", async () => {
    const matchDo = await startedMatch("tictactoe");
    const res = await matchDo.fetch(new Request("http://do/events?playerId=carol"));
    expect(res.status).toBe(403);
  });

  it("needs a player at all", async () => {
    const matchDo = await startedMatch("tictactoe");
    expect((await matchDo.fetch(new Request("http://do/events"))).status).toBe(400);
  });

  it("404s before the match exists", async () => {
    const matchDo = new MatchDO(createCtx(), createEnv());
    const res = await matchDo.fetch(new Request("http://do/events?playerId=alice"));
    expect(res.status).toBe(404);
  });
});

describe("trivia's description", () => {
  it("never carries the answer, which view() hides until the reveal", () => {
    // Guards the leak directly at the module: an `answer` action's
    // description must mention the round and nothing else.
    const described = JSON.stringify(
      serverGames.trivia.describeAction?.(
        { round: 1 },
        { t: "answer", round: 1, choice: 7 },
        "alice",
      ),
    );
    expect(described).toEqual(JSON.stringify({ key: "history.answer", values: { round: 2 } }));
    expect(described).not.toContain("choice");
    expect(described).not.toContain("7");
  });
});

describe("tictactoe's description", () => {
  it("names the mark of whoever moved", () => {
    const state = tictactoeGame.init(["alice", "bob"], 1);
    const oPlayer = state.players.O;
    expect(tictactoeGame.describeAction?.(state, { t: "place", cell: 8 }, oPlayer)).toEqual({
      key: "history.place",
      values: { mark: "O", row: 3, column: 3 },
    });
  });
});
