import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { MockInstance } from "vitest";

import { UNKNOWN_NICKNAME } from "../shared/nickname";
import type { MatchSnapshot, MatchSummary, PlayerInfo } from "../shared/protocol";

// This repo has no @cloudflare/vitest-pool-workers setup (vitest.config.ts
// runs plain "node"), so "cloudflare:workers" — a virtual module that only
// exists inside the workerd runtime — does not resolve here. Stub it with
// the minimal base class `match.ts` actually extends; must be hoisted above
// the `./match` import below (vitest hoists `vi.mock` automatically, but
// spelling it out top-of-file keeps the ordering obvious).
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

// The constructor also reaches for `WebSocketRequestResponsePair`, a global
// workerd runtime class not present under plain node. A no-op stand-in is
// enough — this test never exercises the auto-response ping/pong path.
(globalThis as { WebSocketRequestResponsePair?: unknown }).WebSocketRequestResponsePair ??= class {
  constructor(
    public request: string,
    public response: string,
  ) {}
};

const { counterGame } = await import("../games/__fixtures__/counter");
const { serverGames } = await import("../games/registry");
const { MatchDO } = await import("./match");

// ---------------------------------------------------------------------
// Minimal Durable Object harness. This repo has no @cloudflare/vitest-
// pool-workers setup (vitest.config.ts runs in plain "node"), so MatchDO
// is exercised here by hand-building the slice of `DurableObjectState` /
// `Env` it actually touches, backed by node's built-in `node:sqlite` for
// `ctx.storage.sql` (same SQL surface `match.ts` uses against the real DO
// SQLite storage).
// ---------------------------------------------------------------------

// `connectedAt` is when the socket was accepted and `pingedAt` when its page
// last sent the heartbeat the runtime answers on its own (what
// `ctx.getWebSocketAutoResponseTimestamp` reports). A socket opened just now
// counts as a player watching; setting both into the past is a page that
// went to sleep without closing it.
interface FakeSocket {
  playerId: string;
  sent: Record<string, unknown>[];
  connectedAt: number;
  pingedAt: Date | null;
  send(data: string): void;
  deserializeAttachment(): { playerId: string; connectedAt: number };
}

function createFakeSocket(playerId: string): FakeSocket {
  return {
    playerId,
    sent: [],
    connectedAt: Date.now(),
    pingedAt: null,
    send(data: string) {
      this.sent.push(JSON.parse(data));
    },
    deserializeAttachment() {
      return { playerId, connectedAt: this.connectedAt };
    },
  };
}

// Generic named suspension points, one per `await` inside `commit()`
// (`getAlarm`, `setAlarm`, `deleteAlarm`, and the `env.DB.batch()` call
// inside `syncIndex()`). The round-2 bug was that only the first of these
// was re-validated after resuming; this controller lets a test pause a
// commit() at any single one of them and, critically, *know for certain*
// (via `waitUntilPaused`) that it is genuinely blocked there — as opposed to
// merely hoping a particular `await`/microtask interleaving happens to land
// a second, independent commit's work before the first resumes. Without
// that certainty, a test can pass "by accident" regardless of which await
// staleness was actually re-validated (this is exactly what happened during
// this fix: an earlier draft of these tests relied on dispatch ordering
// alone and passed even against a deliberately-reintroduced round-1-only
// version of commit() for two of the four await points, because the second
// commit's synchronous stage-1 `writeMatch()` — which happens before its
// own first await — had already landed by the time the microtask queue was
// drained, regardless of where the first commit was paused).
function createPauseController() {
  const releasers = new Map<string, () => void>();
  const pending = new Map<string, { blocked: Promise<void>; markReached: () => void }>();
  const reached = new Map<string, Promise<void>>();
  // How many times each named mock has actually been invoked, regardless of
  // whether a pause was armed for it — used by `waitForCallCount` below.
  // Needed because handler methods in match.ts (`handleActionRequest`,
  // `handleLobbyJoin`, ...) all start with `await request.json()`, so even
  // a "fully independent, unpaused" second commit's own stage-1
  // `writeMatch()` is *not* guaranteed to have already happened just
  // because its `fetch()` call was made on the same synchronous turn as an
  // earlier one — it is itself already past its own first await. An
  // earlier draft of these tests assumed otherwise and got lucky/unlucky
  // per pause point as a result (see the comment above `createPauseController`).
  const callCounts = new Map<string, number>();
  const countWaiters = new Map<string, { n: number; resolve: () => void }[]>();

  function bumpCallCount(name: string) {
    const next = (callCounts.get(name) ?? 0) + 1;
    callCounts.set(name, next);
    const waiters = countWaiters.get(name) ?? [];
    const stillWaiting = waiters.filter((w) => {
      if (next < w.n) return true;
      w.resolve();
      return false;
    });
    countWaiters.set(name, stillWaiting);
  }

  return {
    armPause(name: string) {
      let markReached!: () => void;
      reached.set(
        name,
        new Promise<void>((resolve) => {
          markReached = resolve;
        }),
      );
      const blocked = new Promise<void>((resolve) => {
        releasers.set(name, resolve);
      });
      pending.set(name, { blocked, markReached });
    },
    // Called from inside the mocked storage/D1 method itself, at the exact
    // point that corresponds to the real `await` in commit(). Signals
    // `waitUntilPaused` the instant it starts blocking, then blocks for
    // real until `resume()` is called.
    async waitIfArmed(name: string) {
      bumpCallCount(name);
      const entry = pending.get(name);
      if (entry) {
        pending.delete(name);
        entry.markReached();
        await entry.blocked;
      }
    },
    // Resolves only once the commit paused at `name` has actually reached
    // that await and is genuinely blocked there — never based on guessing
    // how many microtask ticks that takes.
    async waitUntilPaused(name: string) {
      const promise = reached.get(name);
      if (!promise) throw new Error(`armPause("${name}") was never called`);
      await promise;
    },
    // Resolves once the named mock has been invoked at least `n` times in
    // total (paused or not) — used to get a hard guarantee that a *second*
    // commit has reached (and therefore already persisted past) a given
    // point, without assuming anything about microtask/await scheduling.
    async waitForCallCount(name: string, n: number) {
      if ((callCounts.get(name) ?? 0) >= n) return;
      await new Promise<void>((resolve) => {
        const waiters = countWaiters.get(name) ?? [];
        waiters.push({ n, resolve });
        countWaiters.set(name, waiters);
      });
    },
    // How many times the named mock has been invoked so far. A test reads it
    // right before dispatching a second commit, then waits for one more.
    callCount(name: string) {
      return callCounts.get(name) ?? 0;
    },
    resume(name: string) {
      const release = releasers.get(name);
      releasers.delete(name);
      release?.();
    },
  };
}

// Controls `ctx.storage.getAlarm()`/`setAlarm()`/`deleteAlarm()`, each
// wired to the shared pause controller under the names "getAlarm",
// "setAlarm", "deleteAlarm" so a test can suspend a commit() at any one of
// them.
function createAlarmController(pauses: ReturnType<typeof createPauseController>) {
  let alarmValue: number | null = null;

  return {
    async getAlarm() {
      await pauses.waitIfArmed("getAlarm");
      return alarmValue;
    },
    async setAlarm(value: number) {
      await pauses.waitIfArmed("setAlarm");
      alarmValue = value;
    },
    async deleteAlarm() {
      await pauses.waitIfArmed("deleteAlarm");
      alarmValue = null;
    },
    get value() {
      return alarmValue;
    },
  };
}

interface RecordedStatement {
  sql: string;
  args: unknown[];
}

// Mocks the D1 binding `MatchDO` touches: `env.DB.batch(statements)` for
// `syncIndex()`, and `.all()` for the one read, the player registry lookup
// that names a roster before it is sent. Records every batch so a test can
// inspect exactly what was written to the index. `batch()` and the lookup
// are wired to the shared pause controller ("dbBatch" and "names"), so a
// test can suspend a commit() at either await. `registry` is the players
// table; a test renames someone by assigning to it, or sets `failLookups`.
function createFakeDB(pauses: ReturnType<typeof createPauseController>) {
  const batches: RecordedStatement[][] = [];
  const registry: Record<string, string> = { alice: "Alice", bob: "Bob", carol: "Carol" };
  const db = {
    failLookups: false,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            sql,
            args,
            async all() {
              await pauses.waitIfArmed("names");
              if (db.failLookups) throw new Error("D1 unavailable");
              return {
                results: (args as string[])
                  .filter((id) => id in registry)
                  .map((id) => ({ id, nickname: registry[id] })),
              };
            },
          };
        },
      };
    },
    async batch(statements: RecordedStatement[]) {
      await pauses.waitIfArmed("dbBatch");
      batches.push(statements.map(({ sql, args }) => ({ sql, args })));
      return statements.map(() => ({ success: true }));
    },
    batches,
    registry,
  };
  return db;
}

function createFakeCtx(
  alarmController: ReturnType<typeof createAlarmController>,
  sockets: FakeSocket[],
) {
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec(sqlText: string, ...params: unknown[]) {
      const stmt = db.prepare(sqlText);
      const isSelect = /^\s*select/i.test(sqlText);
      const rows = isSelect ? (stmt.all(...params) as Record<string, unknown>[]) : [];
      if (!isSelect) stmt.run(...params);
      return {
        toArray: () => rows,
        one: () => rows[0],
      };
    },
  };
  return {
    id: { toString: () => "fake-do-id" },
    storage: {
      sql,
      getAlarm: () => alarmController.getAlarm(),
      setAlarm: (value: number) => alarmController.setAlarm(value),
      deleteAlarm: () => alarmController.deleteAlarm(),
    },
    getWebSockets: () => sockets as unknown as WebSocket[],
    getWebSocketAutoResponseTimestamp: (ws: FakeSocket) => ws.pingedAt,
    acceptWebSocket: () => {},
    setWebSocketAutoResponse: () => {},
    // `nudgeHook` hands its name lookup and Slack call to the runtime;
    // nothing here has a webhook configured, so running it inline is enough.
    waitUntil: (promise: Promise<unknown>) => void promise,
  } as unknown as DurableObjectState;
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://do${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

type MatchDOInstance = InstanceType<typeof MatchDO>;

// A counter match between `players` (the first one hosts), every one of them
// connected, started unless told otherwise. `visibility` is sent only when
// given, so the default is the DO's own.
async function createMatch(
  players: string[],
  { start = true, visibility }: { start?: boolean; visibility?: string } = {},
) {
  const pauses = createPauseController();
  const alarmController = createAlarmController(pauses);
  const sockets = Object.fromEntries(players.map((id) => [id, createFakeSocket(id)]));
  const db = createFakeDB(pauses);
  const ctx = createFakeCtx(alarmController, Object.values(sockets));
  // Nothing is configured to nudge through unless a test sets it.
  const env: { DB: typeof db; SLACK_WEBHOOK_URL?: string } = { DB: db };
  const matchDo = new MatchDO(ctx, env as unknown as Env);

  await matchDo.fetch(
    jsonRequest("/lobby/create", {
      matchId: "m1",
      gameId: "counter",
      hostId: players[0],
      ...(visibility === undefined ? {} : { visibility }),
    }),
  );
  for (const id of players.slice(1)) {
    await matchDo.fetch(jsonRequest("/lobby/join", { playerId: id }));
  }
  if (start) await matchDo.fetch(jsonRequest("/start", { playerId: players[0] }));
  return { matchDo, pauses, alarmController, db, ctx, sockets, env };
}

interface Move {
  playerId: string;
  action: unknown;
}

function play(matchDo: MatchDOInstance, { playerId, action }: Move): Promise<Response> {
  return matchDo.fetch(jsonRequest("/action", { playerId, action }));
}

const increment = (playerId: string): Move => ({ playerId, action: { t: "increment" } });
const pick = (playerId: string, value: number): Move => ({
  playerId,
  action: { t: "pick", value },
});

// Everyone takes their sequential turn, in join order, which moves the
// counter into its simultaneous phase with a deadline armed.
async function reachSimultaneousPhase(matchDo: MatchDOInstance, players: string[]) {
  for (const id of players) await play(matchDo, increment(id));
}

function snapshotsSentTo(socket: FakeSocket): MatchSnapshot[] {
  return socket.sent.filter((m) => m.t === "snapshot") as unknown as MatchSnapshot[];
}

describe("MatchDO.commit() race across every await boundary", () => {
  beforeEach(() => {
    // The counter fixture is deliberately not registered in games/registry
    // (it's test-only) — register it for the duration of this suite only.
    serverGames.counter = counterGame;
  });

  afterEach(() => {
    delete serverGames.counter;
  });

  // Every case below follows the same shape, on a three-player match so a
  // second player is always free to move while the first one's commit is
  // blocked:
  //   1. Get the match into some state, then dispatch (without awaiting) a
  //      move whose commit() is armed to pause at `pausePoint`.
  //   2. `waitUntilPaused` to get a hard guarantee that commit() is now
  //      genuinely blocked at that exact await — not just "probably has run
  //      by now".
  //   3. Run a second, fully independent commit — another player's move —
  //      to completion.
  //   4. Resume the paused commit and let it finish.
  //   5. Assert that everything the resumed commit broadcast/indexed
  //      reflects the second move: its player is no longer waited on. A
  //      commit that kept using what it read before pausing would still
  //      show them as waiting.
  //
  // There is no deleteAlarm case. The counter fixture clears its deadline
  // only on the move that finishes the match, and no route can change a
  // finished match, so there is no second commit to interleave with one
  // paused there.
  async function expectSecondMoveDuringPauseIsNotLost(
    pausePoint: "getAlarm" | "setAlarm" | "names" | "dbBatch",
    // Runs first, entirely unpaused (the pause is armed only afterwards) —
    // gets the match into whatever phase is needed for `pausedMove` to hit
    // `pausePoint`.
    setUp: (matchDo: MatchDOInstance) => Promise<void>,
    // The single move whose own commit() should hit `pausePoint`. Exactly
    // one `matchDo.fetch()` call — not a sequence — or a later, unpaused
    // call in the same sequence would silently re-read fresh state on its
    // own and mask staleness left behind by the first.
    pausedMove: Move,
    secondMove: Move,
  ) {
    const { matchDo, pauses, db, sockets } = await createMatch(["alice", "bob", "carol"]);
    await setUp(matchDo);

    pauses.armPause(pausePoint);
    const pausedAction = play(matchDo, pausedMove);

    // Hard guarantee: the paused commit is now genuinely blocked at
    // `pausePoint`, having already captured whatever it read on the way
    // there.
    await pauses.waitUntilPaused(pausePoint);

    // Baselines. Every snapshot alice has received up to this point was
    // computed before the second move's write, so only later ones can show
    // it; and the call counts below include every call setup made, so the
    // waits after the second move is dispatched count from here.
    const snapshotCountBefore = snapshotsSentTo(sockets.alice).length;
    const getAlarmCallsBefore = pauses.callCount("getAlarm");
    const dbBatchCallsBefore = pauses.callCount("dbBatch");

    // For the `dbBatch` pause point, the second commit's *own* syncIndex()
    // call queues behind the paused one on `dbWriteQueue` (see match.ts) and
    // so cannot fully resolve until the paused one is resumed below — which
    // is why it is not awaited here, but together with `pausedAction` once
    // both are in flight.
    const second = play(matchDo, secondMove);

    // Hard guarantee: the second commit has reached its own `getAlarm()`,
    // so its stage-1 `writeMatch()` has already landed. `handleActionRequest`
    // starts with `await request.json()`, so this is *not* guaranteed just
    // because `matchDo.fetch()` was already called on this synchronous turn.
    await pauses.waitForCallCount("getAlarm", getAlarmCallsBefore + 1);

    // Best-effort (not a hard guarantee, and deliberately bounded): give the
    // second commit's own env.DB.batch() call a chance to run all the way to
    // completion before the paused one resumes. That raises the odds of
    // reproducing the D1-write-ordering race — the resumed commit's own,
    // already-stale batch() payload landing *after* the second commit's
    // fresher one — when `dbWriteQueue`'s serialization is missing. It
    // cannot be a hard `await`: with `dbWriteQueue` present and `pausePoint
    // === "dbBatch"`, the second call is gated behind the paused one until
    // `resume()` below, so waiting unconditionally here would deadlock.
    await Promise.race([
      pauses.waitForCallCount("dbBatch", dbBatchCallsBefore + 1),
      new Promise((resolve) => setTimeout(resolve, 10)),
    ]);

    pauses.resume(pausePoint);
    const [pausedResponse, secondResponse] = await Promise.all([pausedAction, second]);
    expect(pausedResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);

    // Both commits broadcast to alice from here, in no guaranteed relative
    // order, so "the last snapshot" does not isolate what the paused commit
    // sent. Instead, every snapshot after the baseline must show the second
    // move: the second commit's own broadcast is correct by construction, so
    // this fails only if the paused commit's broadcast is the stale one.
    const after = snapshotsSentTo(sockets.alice).slice(snapshotCountBefore);
    expect(after.length).toBeGreaterThan(0);
    for (const snapshot of after) expect(snapshot.waitingOn).not.toContain(secondMove.playerId);

    const rows = db.batches
      .flat()
      .filter(
        (s) => s.sql.includes("INSERT INTO match_players") && s.args[1] === secondMove.playerId,
      );
    expect(rows.length).toBeGreaterThan(0);
    const [, , waiting] = rows[rows.length - 1].args;
    expect(waiting).toBe(0);
  }

  const everyone = ["alice", "bob", "carol"];

  it("re-validates freshness after the getAlarm await", async () => {
    // getAlarm fires unconditionally on every commit — alice's pick
    // (simultaneous phase, deadline already armed) is enough to reach it.
    await expectSecondMoveDuringPauseIsNotLost(
      "getAlarm",
      (matchDo) => reachSimultaneousPhase(matchDo, everyone),
      pick("alice", 10),
      pick("bob", 20),
    );
  });

  it("re-validates freshness after the setAlarm await", async () => {
    // setAlarm only fires when the deadline changes to a new non-null value
    // — the sequential -> simultaneous transition (carol's increment, the
    // last of the three) is the only place the counter fixture hits it.
    // Once it has persisted, alice is free to pick.
    await expectSecondMoveDuringPauseIsNotLost(
      "setAlarm",
      async (matchDo) => {
        await play(matchDo, increment("alice"));
        await play(matchDo, increment("bob"));
      },
      increment("carol"),
      pick("alice", 10),
    );
  });

  it("re-validates freshness after the player-name lookup await", async () => {
    // Every broadcast names its roster from the player registry first, so
    // this await, like getAlarm, is on every commit's path.
    await expectSecondMoveDuringPauseIsNotLost(
      "names",
      (matchDo) => reachSimultaneousPhase(matchDo, everyone),
      pick("alice", 10),
      pick("bob", 20),
    );
  });

  it("re-validates freshness after the dbBatch await inside syncIndex", async () => {
    // syncIndex's env.DB.batch() call fires unconditionally on every
    // commit, same as getAlarm — reuse the same setup.
    await expectSecondMoveDuringPauseIsNotLost(
      "dbBatch",
      (matchDo) => reachSimultaneousPhase(matchDo, everyone),
      pick("alice", 10),
      pick("bob", 20),
    );
  });

  it("still broadcasts and indexes the finishing 'done' status correctly when a second commit finishes the match while the first is paused", async () => {
    // The game-outcome-shaped repro: alice's pick is paused at getAlarm;
    // while it is blocked there, bob's pick runs to completion and finishes
    // the match. Alice's resumed commit must reflect "done", not the
    // "active" state it saw on the way into the pause.
    const { matchDo, pauses, alarmController, db, sockets } = await createMatch(["alice", "bob"]);
    await reachSimultaneousPhase(matchDo, ["alice", "bob"]);
    expect(alarmController.value).not.toBeNull();

    pauses.armPause("getAlarm");
    const alicePick = play(matchDo, pick("alice", 10));
    await pauses.waitUntilPaused("getAlarm");

    const bobResponse = await play(matchDo, pick("bob", 20));
    expect(bobResponse.status).toBe(200);

    pauses.resume("getAlarm");
    const aliceResponse = await alicePick;
    expect(aliceResponse.status).toBe(200);

    const aliceLast = snapshotsSentTo(sockets.alice).at(-1);
    expect(aliceLast?.status).toBe("done");
    expect(aliceLast?.waitingOn).toEqual([]);
    expect(aliceLast?.deadline).toBeNull();

    const matchUpserts = db.batches.flat().filter((s) => s.sql.includes("INSERT INTO matches"));
    expect(matchUpserts.length).toBeGreaterThan(0);
    const [, , status, , , deadline] = matchUpserts[matchUpserts.length - 1].args;
    expect(status).toBe("done");
    expect(deadline).toBeNull();

    expect(alarmController.value).toBeNull();
  });
});

describe("MatchDO rosters", () => {
  beforeEach(() => {
    serverGames.counter = counterGame;
  });

  afterEach(() => {
    delete serverGames.counter;
  });

  async function viewFor(matchDo: MatchDOInstance, playerId: string): Promise<MatchSnapshot> {
    const res = await matchDo.fetch(new Request(`http://do/view?playerId=${playerId}`));
    expect(res.status).toBe(200);
    return (await res.json()) as MatchSnapshot;
  }

  const namesIn = (roster: { players: PlayerInfo[] }) => roster.players.map((p) => p.nickname);

  it("names every roster from the registry as it is sent, so a rename reaches the match at once", async () => {
    const { matchDo, db, sockets } = await createMatch(["alice", "bob"]);
    expect(namesIn(await viewFor(matchDo, "alice"))).toEqual(["Alice", "Bob"]);

    db.registry.bob = "Robert";
    expect(namesIn(await viewFor(matchDo, "alice"))).toEqual(["Alice", "Robert"]);

    await play(matchDo, increment("alice"));
    const broadcast = snapshotsSentTo(sockets.bob).at(-1);
    expect(broadcast && namesIn(broadcast)).toEqual(["Alice", "Robert"]);
  });

  it("stores ids, never names: not in the match record, the event log or the index", async () => {
    const { matchDo, db, ctx } = await createMatch(["alice", "bob"]);
    await play(matchDo, increment("alice"));

    const [stored] = ctx.storage.sql
      .exec("SELECT value FROM meta WHERE key = 'match'")
      .toArray() as { value: string }[];
    const events = await (
      await matchDo.fetch(new Request("http://do/events?playerId=alice"))
    ).text();
    for (const written of [stored.value, events, JSON.stringify(db.batches)]) {
      expect(written).not.toMatch(/Alice|Bob/);
    }
  });

  it("shows a placeholder when the registry cannot be read, rather than failing the snapshot", async () => {
    const { matchDo, db } = await createMatch(["alice", "bob"]);
    db.failLookups = true;
    expect(namesIn(await viewFor(matchDo, "alice"))).toEqual([UNKNOWN_NICKNAME, UNKNOWN_NICKNAME]);
  });

  it("names a player who joins while the roster is being looked up", async () => {
    const { matchDo, pauses } = await createMatch(["alice"], { start: false });
    pauses.armPause("names");
    const lobby = matchDo.fetch(new Request("http://do/snapshot"));
    await pauses.waitUntilPaused("names");

    const join = await matchDo.fetch(jsonRequest("/lobby/join", { playerId: "bob" }));
    expect(join.status).toBe(200);

    pauses.resume("names");
    const summary = (await (await lobby).json()) as MatchSummary;
    expect(summary.players).toEqual([
      { id: "alice", nickname: "Alice" },
      { id: "bob", nickname: "Bob" },
    ]);
  });

  it("treats a re-join as a no-op that changes nothing", async () => {
    const { matchDo } = await createMatch(["alice", "bob"]);
    const before = await (
      await matchDo.fetch(new Request("http://do/events?playerId=alice"))
    ).text();
    const rejoin = await matchDo.fetch(jsonRequest("/lobby/join", { playerId: "bob" }));
    expect(rejoin.status).toBe(200);
    const after = await (
      await matchDo.fetch(new Request("http://do/events?playerId=alice"))
    ).text();
    expect(after).toBe(before);
  });
});

describe("MatchDO visibility", () => {
  beforeEach(() => {
    serverGames.counter = counterGame;
  });

  afterEach(() => {
    delete serverGames.counter;
  });

  async function lobby(matchDo: MatchDOInstance): Promise<MatchSummary> {
    return (await (await matchDo.fetch(new Request("http://do/snapshot"))).json()) as MatchSummary;
  }

  function setVisibility(matchDo: MatchDOInstance, playerId: string, visibility: string) {
    return matchDo.fetch(jsonRequest("/lobby/visibility", { playerId, visibility }));
  }

  // The visibility the index was last told, from the newest `matches` upsert.
  function indexedVisibility(db: ReturnType<typeof createFakeDB>): unknown {
    const upserts = db.batches.flat().filter((s) => s.sql.includes("INSERT INTO matches"));
    return upserts.at(-1)?.args.at(-1);
  }

  it("is private unless the host asks otherwise", async () => {
    const { matchDo, db } = await createMatch(["alice"], { start: false });
    expect((await lobby(matchDo)).visibility).toBe("private");
    expect(indexedVisibility(db)).toBe("private");
  });

  it("is public from the start when created that way, in the lobby and in the index", async () => {
    const { matchDo, db } = await createMatch(["alice"], { start: false, visibility: "public" });
    expect((await lobby(matchDo)).visibility).toBe("public");
    expect(indexedVisibility(db)).toBe("public");
  });

  it("lets the host change it in the lobby, without logging an event", async () => {
    const { matchDo, db } = await createMatch(["alice", "bob"], { start: false });
    const eventsBefore = await (
      await matchDo.fetch(new Request("http://do/events?playerId=alice"))
    ).text();

    const res = await setVisibility(matchDo, "alice", "public");
    expect(res.status).toBe(200);
    expect(((await res.json()) as MatchSummary).visibility).toBe("public");
    expect(indexedVisibility(db)).toBe("public");

    await setVisibility(matchDo, "alice", "private");
    expect((await lobby(matchDo)).visibility).toBe("private");
    expect(indexedVisibility(db)).toBe("private");

    const eventsAfter = await (
      await matchDo.fetch(new Request("http://do/events?playerId=alice"))
    ).text();
    expect(eventsAfter).toBe(eventsBefore);
  });

  it("refuses anyone but the host", async () => {
    const { matchDo } = await createMatch(["alice", "bob"], { start: false });
    const res = await setVisibility(matchDo, "bob", "public");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("not_host");
    expect((await lobby(matchDo)).visibility).toBe("private");
  });

  it("refuses once the match has started, since only a lobby takes new players", async () => {
    const { matchDo } = await createMatch(["alice", "bob"]);
    const res = await setVisibility(matchDo, "alice", "public");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("already_started");
  });

  it("rejects a setting that is neither private nor public", async () => {
    const { matchDo } = await createMatch(["alice"], { start: false });
    expect((await setVisibility(matchDo, "alice", "friends")).status).toBe(400);
  });

  it("reads a match recorded before visibility existed as private", async () => {
    const { matchDo, ctx } = await createMatch(["alice"], { start: false, visibility: "public" });
    const [stored] = ctx.storage.sql
      .exec("SELECT value FROM meta WHERE key = 'match'")
      .toArray() as { value: string }[];
    const { visibility: _dropped, ...older } = JSON.parse(stored.value) as Record<string, unknown>;
    ctx.storage.sql.exec("UPDATE meta SET value = ? WHERE key = 'match'", JSON.stringify(older));
    expect((await lobby(matchDo)).visibility).toBe("private");
  });

  // A public lobby's alarm is when its listing runs out. The clock is faked (Date only, so the
  // harness's own timers still run) to move a day forward without waiting one.
  describe("listing expiry", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const T0 = Date.UTC(2026, 8, 1, 9);

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(T0);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("arms the alarm for a day after the lobby goes public, and only then", async () => {
      const { matchDo, alarmController } = await createMatch(["alice"], { start: false });
      expect(alarmController.value).toBeNull();

      vi.setSystemTime(T0 + 1000);
      await setVisibility(matchDo, "alice", "public");
      expect(alarmController.value).toBe(T0 + 1000 + DAY);

      await setVisibility(matchDo, "alice", "private");
      expect(alarmController.value).toBeNull();
    });

    it("takes a lobby nobody joined off the hub a day later, and leaves it a lobby", async () => {
      const { matchDo, alarmController, db } = await createMatch(["alice"], {
        start: false,
        visibility: "public",
      });
      expect(alarmController.value).toBe(T0 + DAY);

      vi.setSystemTime(T0 + DAY);
      await matchDo.alarm();
      const expired = await lobby(matchDo);
      expect(expired.visibility).toBe("private");
      expect(expired.status).toBe("lobby");
      expect(indexedVisibility(db)).toBe("private");
      expect(alarmController.value).toBeNull();

      // Its code still works, and the host can list it again for another day.
      expect((await matchDo.fetch(jsonRequest("/lobby/join", { playerId: "bob" }))).status).toBe(
        200,
      );
      await setVisibility(matchDo, "alice", "public");
      expect(alarmController.value).toBe(T0 + DAY + DAY);
    });

    it("starts the day over when somebody joins", async () => {
      const { matchDo, alarmController } = await createMatch(["alice"], {
        start: false,
        visibility: "public",
      });
      vi.setSystemTime(T0 + DAY / 2);
      await matchDo.fetch(jsonRequest("/lobby/join", { playerId: "bob" }));
      expect(alarmController.value).toBe(T0 + DAY / 2 + DAY);

      // An alarm firing at the original time finds half a day left, and waits for it.
      vi.setSystemTime(T0 + DAY);
      await matchDo.alarm();
      expect((await lobby(matchDo)).visibility).toBe("public");
      expect(alarmController.value).toBe(T0 + DAY / 2 + DAY);
    });

    it("hands the alarm to the game once the match starts", async () => {
      const { matchDo, alarmController } = await createMatch(["alice", "bob"], {
        visibility: "public",
      });
      // The counter's opening phase has no deadline, so nothing is armed at all.
      expect(alarmController.value).toBeNull();

      vi.setSystemTime(T0 + DAY);
      await matchDo.alarm();
      const view = await matchDo.fetch(new Request("http://do/view?playerId=alice"));
      expect(((await view.json()) as MatchSnapshot).status).toBe("active");
    });
  });
});

describe("MatchDO nudges", () => {
  const HOOK = "http://slack.test/hook";
  const LONG_AGO = Date.now() - 60 * 60 * 1000;
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    serverGames.counter = counterGame;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
  });

  afterEach(() => {
    delete serverGames.counter;
    fetchSpy.mockRestore();
  });

  // The Slack messages sent so far, once the `waitUntil()` chains that send
  // them have run. Slack stands in for both channels: they share the
  // decision of who to nudge, and only the delivery differs.
  async function nudges(): Promise<string[]> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    return fetchSpy.mock.calls
      .filter(([url]) => url === HOOK)
      .map(([, init]) => (JSON.parse(String(init?.body)) as { text: string }).text);
  }

  // A lobby of `players` who have all looked away since they joined, with
  // Slack configured; started by the caller.
  async function awayMatch(players: string[]) {
    const created = await createMatch(players, { start: false });
    created.env.SLACK_WEBHOOK_URL = HOOK;
    for (const socket of Object.values(created.sockets)) socket.connectedAt = LONG_AGO;
    return created;
  }

  it("nudges a player whose socket is still open but whose page has gone quiet", async () => {
    const { matchDo, sockets } = await awayMatch(["alice", "bob"]);
    sockets.alice.pingedAt = new Date(LONG_AGO);
    await matchDo.fetch(jsonRequest("/start", { playerId: "alice" }));
    expect(await nudges()).toEqual([expect.stringMatching(/^Alice is up/)]);
  });

  it("does not nudge a player whose page is keeping up its heartbeat", async () => {
    const { matchDo, sockets } = await awayMatch(["alice", "bob"]);
    sockets.alice.pingedAt = new Date();
    await matchDo.fetch(jsonRequest("/start", { playerId: "alice" }));
    expect(await nudges()).toEqual([]);
  });

  // Each move answers the nudge that brought its player back, so a quick
  // exchange nudges on every turn rather than waiting out the floor between
  // two nudges to the same player.
  it("nudges on every turn of a quick exchange between two players who keep looking away", async () => {
    const { matchDo } = await awayMatch(["alice", "bob"]);
    await matchDo.fetch(jsonRequest("/start", { playerId: "alice" }));
    await play(matchDo, increment("alice"));
    await play(matchDo, increment("bob"));

    const sent = await nudges();
    expect(sent.map((text) => text.split(" ")[0])).toEqual(["Alice", "Bob", "Alice"]);
  });
});
