import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

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
(globalThis as { WebSocketRequestResponsePair?: unknown }).WebSocketRequestResponsePair ??=
  class {
    constructor(
      public request: string,
      public response: string
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

interface FakeSocket {
  playerId: string;
  nickname: string;
  sent: Record<string, unknown>[];
  send(data: string): void;
  deserializeAttachment(): { playerId: string; nickname: string };
}

function createFakeSocket(playerId: string, nickname: string): FakeSocket {
  return {
    playerId,
    nickname,
    sent: [],
    send(data: string) {
      this.sent.push(JSON.parse(data));
    },
    deserializeAttachment() {
      return { playerId, nickname };
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
        })
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

// Mocks the D1 binding used by `syncIndex()`: `env.DB.prepare(sql).bind(...)`
// building a statement, `env.DB.batch(statements)` executing them. Records
// every batch so the test can inspect exactly what was written to the index.
// `batch()` is wired to the shared pause controller under "dbBatch" so a
// test can suspend a commit() at that fourth await too.
function createFakeDB(pauses: ReturnType<typeof createPauseController>) {
  const batches: RecordedStatement[][] = [];
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]): RecordedStatement {
          return { sql, args };
        },
      };
    },
    async batch(statements: RecordedStatement[]) {
      await pauses.waitIfArmed("dbBatch");
      batches.push(statements);
      return statements.map(() => ({ success: true }));
    },
    batches,
  };
}

function createFakeCtx(
  alarmController: ReturnType<typeof createAlarmController>,
  sockets: FakeSocket[]
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
    acceptWebSocket: () => {},
    setWebSocketAutoResponse: () => {},
  } as unknown as DurableObjectState;
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://do${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
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

  // Every case below follows the same shape:
  //   1. Get the match into some state, then dispatch (without awaiting) an
  //      action whose commit() is armed to pause at `pausePoint`.
  //   2. `waitUntilPaused` to get a hard guarantee that commit() is now
  //      genuinely blocked at that exact await — not just "probably has run
  //      by now".
  //   3. Run a second, fully-independent commit (bob re-joining under a new
  //      nickname — allowed regardless of match status, so it is always
  //      available as the "second mutation" no matter which phase the
  //      paused commit left the match in) to completion.
  //   4. Resume the paused commit and let it finish.
  //   5. Assert everything the resumed commit broadcast/indexed reflects
  //      the rejoin (nickname "Bobby"), not the pre-pause nickname ("Bob")
  //      — the same class of staleness the status/waitingOn/deadline fields
  //      would show, but probed via a field that stays observable no matter
  //      which of the four await points is under test or what phase the
  //      match is in when it's reached.
  async function expectRejoinDuringPauseIsNotLost(
    pausePoint: "getAlarm" | "setAlarm" | "deleteAlarm" | "dbBatch",
    // Runs first, entirely unpaused (the pause is armed only afterwards) —
    // gets the match into whatever phase is needed for the *next* action to
    // hit `pausePoint`.
    setUp: (matchDo: InstanceType<typeof MatchDO>) => Promise<void>,
    // The exact single action whose own commit() should hit `pausePoint`.
    // Must be exactly one `matchDo.fetch()` call — not a sequence — or a
    // later, unpaused call in the same sequence would silently re-read
    // fresh state on its own and mask staleness left behind by the first.
    dispatchPausedAction: (matchDo: InstanceType<typeof MatchDO>) => Promise<Response>
  ) {
    const pauses = createPauseController();
    const alarmController = createAlarmController(pauses);
    const alice = createFakeSocket("alice", "Alice");
    const bob = createFakeSocket("bob", "Bob");
    const db = createFakeDB(pauses);
    const ctx = createFakeCtx(alarmController, [alice, bob]);
    const env = { DB: db } as unknown as Env;
    const matchDo = new MatchDO(ctx, env);

    await matchDo.fetch(
      jsonRequest("/lobby/create", {
        matchId: "m1",
        gameId: "counter",
        host: { id: "alice", nickname: "Alice" },
      })
    );
    await matchDo.fetch(jsonRequest("/lobby/join", { id: "bob", nickname: "Bob" }));
    await matchDo.fetch(jsonRequest("/start", { playerId: "alice" }));
    await setUp(matchDo);

    pauses.armPause(pausePoint);
    const pausedAction = dispatchPausedAction(matchDo);

    // Hard guarantee: the paused commit is now genuinely blocked at
    // `pausePoint`, having already captured whatever pre-rejoin
    // current/waitingOn/deadline it read on the way there.
    await pauses.waitUntilPaused(pausePoint);

    // Dispatch a fully independent second commit — bob re-joining under a
    // new nickname. For the `dbBatch` pause point specifically, this
    // commit's *own* syncIndex() call queues behind the paused one on
    // `dbWriteQueue` (see match.ts) and so cannot fully resolve until the
    // paused one is resumed below — deliberately not awaited here for that
    // reason; it is awaited together with `pausedAction` once both are in
    // flight.
    // Baseline: every snapshot alice has received *up to and including this
    // point* was necessarily computed before rejoin's persisted write — new
    // ones from here on are the only ones that could possibly show it.
    const snapshotCountBeforeRejoin = alice.sent.filter((m) => m.t === "snapshot").length;

    const rejoin = matchDo.fetch(jsonRequest("/lobby/join", { id: "bob", nickname: "Bobby" }));

    // Hard guarantee (see the comment on `callCounts` above): rejoin's own
    // commit() has reached — and therefore already run its stage-1
    // `writeMatch()` before — its own `getAlarm()` call. `handleLobbyJoin`
    // itself starts with `await request.json()`, so this is *not*
    // guaranteed just because `matchDo.fetch()` for rejoin was already
    // called on this synchronous turn.
    await pauses.waitForCallCount("getAlarm", 2);

    // Best-effort (not a hard guarantee, and deliberately bounded): give
    // rejoin's own env.DB.batch() call a chance to reach `pausePoint` too
    // and, if nothing is gating it there (i.e. `pausePoint` is not
    // "dbBatch", or `dbWriteQueue` is not actually serializing calls),
    // let it run all the way to completion before the paused action is
    // resumed below. This raises the odds of deterministically reproducing
    // the D1-write-ordering race — the resumed (paused) commit's own,
    // already-stale-by-the-time-it-was-built batch() payload landing
    // *after* rejoin's fresher one — when `dbWriteQueue`'s serialization
    // is missing. It cannot be a hard `await`: with `dbWriteQueue` present
    // and `pausePoint === "dbBatch"`, rejoin's own call is permanently
    // gated behind the still-paused one until `resume()` below, so waiting
    // unconditionally here would deadlock.
    await Promise.race([
      pauses.waitForCallCount("dbBatch", 2),
      new Promise((resolve) => setTimeout(resolve, 10)),
    ]);

    pauses.resume(pausePoint);
    const [pausedResponse, rejoinResponse] = await Promise.all([pausedAction, rejoin]);
    expect(pausedResponse.status).toBe(200);
    expect(rejoinResponse.status).toBe(200);

    // The bug: the resumed commit would broadcast/index the nickname it
    // captured before pausing ("Bob"), not the truth as of when it actually
    // finished ("Bobby"). Two commits both broadcast to alice's socket from
    // here (the paused-then-resumed action, and bob's rejoin), in no
    // guaranteed relative order — picking "the last snapshot", or even "the
    // one with the highest seq" (ties are common: an idempotent re-join
    // appends no event, so it often shares its seq with whichever commit's
    // event most recently landed), is not reliable enough to isolate what
    // the paused commit itself sent. Instead: every snapshot sent to alice
    // *after* the baseline captured above must show "Bobby" — rejoin's own
    // broadcast is correct by construction, so this only fails if the
    // *other* (paused) commit's broadcast is the stale one.
    const aliceSnapshotsAfterRejoin = (
      alice.sent.filter((m) => m.t === "snapshot") as { players: { id: string; nickname: string }[] }[]
    ).slice(snapshotCountBeforeRejoin);
    expect(aliceSnapshotsAfterRejoin.length).toBeGreaterThan(0);
    for (const snapshot of aliceSnapshotsAfterRejoin) {
      const bobPlayerInSnapshot = snapshot.players.find((p) => p.id === "bob");
      expect(bobPlayerInSnapshot?.nickname).toBe("Bobby");
    }

    const allStatements = db.batches.flat();
    const bobIndexRows = allStatements.filter(
      (s) => s.sql.includes("INSERT INTO match_players") && s.args[1] === "bob"
    );
    expect(bobIndexRows.length).toBeGreaterThan(0);
    const lastBobIndexRow = bobIndexRows[bobIndexRows.length - 1];
    expect(lastBobIndexRow.args[3]).toBe("Bobby");
  }

  // Advances the match through the sequential phase into "simultaneous"
  // with a deadline armed — shared, unpaused setup for the getAlarm/dbBatch
  // cases below, both of which pause on alice's first (non-finishing) pick.
  async function setUpSimultaneousPhase(matchDo: InstanceType<typeof MatchDO>) {
    await matchDo.fetch(jsonRequest("/action", { playerId: "alice", action: { t: "increment" } }));
    await matchDo.fetch(jsonRequest("/action", { playerId: "bob", action: { t: "increment" } }));
  }

  it("re-validates freshness after the getAlarm await", async () => {
    // getAlarm fires unconditionally on every commit — alice's first pick
    // (simultaneous phase, deadline already armed) is enough to reach it.
    await expectRejoinDuringPauseIsNotLost(
      "getAlarm",
      setUpSimultaneousPhase,
      (matchDo) =>
        matchDo.fetch(jsonRequest("/action", { playerId: "alice", action: { t: "pick", value: 10 } }))
    );
  });

  it("re-validates freshness after the setAlarm await", async () => {
    // setAlarm only fires when the deadline changes to a new non-null
    // value — the sequential -> simultaneous transition (bob's second
    // increment) is the only place the counter fixture hits it. The paused
    // action here IS the second increment, so setup is only alice's first.
    await expectRejoinDuringPauseIsNotLost(
      "setAlarm",
      (matchDo) =>
        matchDo
          .fetch(jsonRequest("/action", { playerId: "alice", action: { t: "increment" } }))
          .then(() => undefined),
      (matchDo) =>
        matchDo.fetch(jsonRequest("/action", { playerId: "bob", action: { t: "increment" } }))
    );
  });

  it("re-validates freshness after the deleteAlarm await", async () => {
    // deleteAlarm only fires when the deadline goes from non-null to null
    // — with this fixture that only happens on the finishing pick. Setup
    // gets both players through the sequential phase and alice through her
    // (non-finishing) pick; the paused action is bob's finishing pick.
    await expectRejoinDuringPauseIsNotLost(
      "deleteAlarm",
      async (matchDo) => {
        await setUpSimultaneousPhase(matchDo);
        await matchDo.fetch(
          jsonRequest("/action", { playerId: "alice", action: { t: "pick", value: 10 } })
        );
      },
      (matchDo) =>
        matchDo.fetch(jsonRequest("/action", { playerId: "bob", action: { t: "pick", value: 20 } }))
    );
  });

  it("re-validates freshness after the dbBatch await inside syncIndex", async () => {
    // syncIndex's env.DB.batch() call fires unconditionally on every
    // commit, same as getAlarm — reuse the same setup.
    await expectRejoinDuringPauseIsNotLost(
      "dbBatch",
      setUpSimultaneousPhase,
      (matchDo) =>
        matchDo.fetch(jsonRequest("/action", { playerId: "alice", action: { t: "pick", value: 10 } }))
    );
  });

  it("still broadcasts and indexes the finishing 'done' status correctly when a second commit finishes the match while the first is paused", async () => {
    // The original, game-outcome-shaped repro (kept alongside the
    // nickname-based probes above): alice's pick is paused at getAlarm;
    // while it is blocked there, bob's pick runs to completion and finishes
    // the match. Alice's resumed commit must reflect "done", not the
    // "active" state it saw on the way into the pause.
    const pauses = createPauseController();
    const alarmController = createAlarmController(pauses);
    const alice = createFakeSocket("alice", "Alice");
    const bob = createFakeSocket("bob", "Bob");
    const db = createFakeDB(pauses);
    const ctx = createFakeCtx(alarmController, [alice, bob]);
    const env = { DB: db } as unknown as Env;
    const matchDo = new MatchDO(ctx, env);

    await matchDo.fetch(
      jsonRequest("/lobby/create", {
        matchId: "m1",
        gameId: "counter",
        host: { id: "alice", nickname: "Alice" },
      })
    );
    await matchDo.fetch(jsonRequest("/lobby/join", { id: "bob", nickname: "Bob" }));
    await matchDo.fetch(jsonRequest("/start", { playerId: "alice" }));
    await matchDo.fetch(jsonRequest("/action", { playerId: "alice", action: { t: "increment" } }));
    await matchDo.fetch(jsonRequest("/action", { playerId: "bob", action: { t: "increment" } }));
    expect(alarmController.value).not.toBeNull();

    pauses.armPause("getAlarm");
    const alicePick = matchDo.fetch(
      jsonRequest("/action", { playerId: "alice", action: { t: "pick", value: 10 } })
    );
    await pauses.waitUntilPaused("getAlarm");

    const bobResponse = await matchDo.fetch(
      jsonRequest("/action", { playerId: "bob", action: { t: "pick", value: 20 } })
    );
    expect(bobResponse.status).toBe(200);

    pauses.resume("getAlarm");
    const aliceResponse = await alicePick;
    expect(aliceResponse.status).toBe(200);

    const aliceSnapshots = alice.sent.filter((m) => m.t === "snapshot");
    const aliceLast = aliceSnapshots[aliceSnapshots.length - 1];
    expect(aliceLast.status).toBe("done");
    expect(aliceLast.waitingOn).toEqual([]);
    expect(aliceLast.deadline).toBeNull();

    const allStatements = db.batches.flat();
    const matchUpserts = allStatements.filter((s) => s.sql.includes("INSERT INTO matches"));
    expect(matchUpserts.length).toBeGreaterThan(0);
    const lastMatchUpsert = matchUpserts[matchUpserts.length - 1];
    const [, , status, , , deadline] = lastMatchUpsert.args;
    expect(status).toBe("done");
    expect(deadline).toBeNull();

    expect(alarmController.value).toBeNull();
  });
});
