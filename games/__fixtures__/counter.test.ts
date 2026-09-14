import { describe, expect, it } from "vitest";

import { counterGame, init, onDeadline, reduce, result, view, waitingOn } from "./counter";
import type { CounterState } from "./counter";

const PLAYERS = ["alice", "bob"];

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.values(obj as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(obj);
  }
  return obj;
}

describe("counter fixture — init", () => {
  it("is deterministic for a fixed seed", () => {
    expect(init(PLAYERS, 7)).toEqual(init(PLAYERS, 7));
  });

  it("rejects fewer than 2 players", () => {
    expect(() => init(["solo"], 1)).toThrow();
  });
});

describe("counter fixture — reduce purity", () => {
  it("does not mutate its input state and returns a new object", () => {
    const state = deepFreeze(init(PLAYERS, 1));
    const before = structuredClone(state);
    const next = reduce(state, { t: "increment" }, "alice", 1000);
    expect(state).toEqual(before); // untouched
    expect(next).not.toBe(state);
  });

  it("same inputs produce deeply equal outputs", () => {
    const a = reduce(init(PLAYERS, 1), { t: "increment" }, "alice", 1000);
    const b = reduce(init(PLAYERS, 1), { t: "increment" }, "alice", 1000);
    expect(a).toEqual(b);
  });
});

describe("counter fixture — sequential phase", () => {
  it("hands the turn to the next player, in order", () => {
    let state = init(PLAYERS, 1);
    expect(waitingOn(state)).toEqual([state.players[state.turnIndex]]);

    const first = waitingOn(state)[0];
    state = reduce(state, { t: "increment" }, first, 1000);
    expect(state.total).toBe(1);
    expect(state.phase).toBe("sequential"); // one player left
  });

  it("rejects an out-of-turn action", () => {
    const state = init(PLAYERS, 1);
    const notTurn = state.players.find((p) => p !== waitingOn(state)[0]) as string;
    expect(() => reduce(state, { t: "increment" }, notTurn, 1000)).toThrow();
  });

  it("moves to the simultaneous phase once every player has gone once", () => {
    let state = init(PLAYERS, 1);
    for (const p of [...state.players]) {
      const turn = waitingOn(state)[0];
      expect(turn).toBe(p);
      state = reduce(state, { t: "increment" }, turn, 1000);
    }
    expect(state.phase).toBe("simultaneous");
    expect(waitingOn(state)).toEqual(expect.arrayContaining(state.players));
  });
});

function advanceToSimultaneous(seed: number): CounterState {
  let state = init(PLAYERS, seed);
  for (const _p of state.players) {
    const turn = waitingOn(state)[0];
    state = reduce(state, { t: "increment" }, turn, 1000);
  }
  return state;
}

describe("counter fixture — simultaneous phase", () => {
  it("resolves once every player has picked", () => {
    let state = advanceToSimultaneous(1);
    for (const p of state.players) {
      state = reduce(state, { t: "pick", value: 5 }, p, 2000);
    }
    expect(state.phase).toBe("done");
    expect(waitingOn(state)).toEqual([]);
    expect(result(state)).not.toBeNull();
  });

  it("rejects a second pick from the same player in the same round", () => {
    let state = advanceToSimultaneous(1);
    state = reduce(state, { t: "pick", value: 5 }, state.players[0], 2000);
    expect(() => reduce(state, { t: "pick", value: 5 }, state.players[0], 2000)).toThrow();
  });
});

describe("counter fixture — waitingOn / result invariant", () => {
  it("waitingOn is [] exactly when result() is non-null", () => {
    let state = advanceToSimultaneous(3);
    expect(waitingOn(state).length).toBeGreaterThan(0);
    expect(result(state)).toBeNull();

    for (const p of state.players) {
      state = reduce(state, { t: "pick", value: 1 }, p, 2000);
    }
    expect(waitingOn(state)).toEqual([]);
    expect(result(state)).not.toBeNull();
  });
});

describe("counter fixture — onDeadline", () => {
  it("assigns 0 to non-submitters and finishes the round", () => {
    let state = advanceToSimultaneous(5);
    // Only the first player submits; the rest miss the deadline.
    state = reduce(state, { t: "pick", value: 9 }, state.players[0], 2000);
    const resolved = onDeadline(state, 999_999);
    expect(resolved.phase).toBe("done");
    for (const p of state.players.slice(1)) {
      expect(resolved.picks[p]).toBe(0);
    }
  });

  it("is idempotent: applying it twice is a no-op on the second application", () => {
    const state = advanceToSimultaneous(5);
    const once = onDeadline(state, 999_999);
    const twice = onDeadline(once, 999_999);
    expect(twice).toEqual(once);
  });

  it("is a no-op outside the simultaneous phase", () => {
    const state = init(PLAYERS, 1); // sequential phase
    expect(onDeadline(state, 1)).toEqual(state);
  });
});

describe("counter fixture — view()", () => {
  it("does not leak another player's secret", () => {
    const state = init(PLAYERS, 42);
    const viewA = view(state, "alice") as { mySecret: number };
    expect(viewA).not.toHaveProperty("secret");
    expect(viewA.mySecret).toBe(state.secret.alice);
    expect(JSON.stringify(viewA)).not.toContain(`"${state.secret.bob}"`);
  });

  it("never returns the raw state object", () => {
    const state = init(PLAYERS, 1);
    expect(view(state, "alice")).not.toBe(state);
  });
});

describe("counter fixture — module shape", () => {
  it("validates actions with actionSchema", () => {
    expect(counterGame.actionSchema.safeParse({ t: "increment" }).success).toBe(true);
    expect(counterGame.actionSchema.safeParse({ t: "pick", value: 3 }).success).toBe(true);
    expect(counterGame.actionSchema.safeParse({ t: "nonsense" }).success).toBe(false);
  });
});
