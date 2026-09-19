import { describe, expect, it } from "vitest";

import {
  CELLS,
  FLEET,
  SIZE,
  TURN_TIMEOUT_MS,
  battleshipGame,
  cellName,
  describeAction,
  fleetCells,
  init,
  onDeadline,
  randomFleet,
  reduce,
  result,
  shipCells,
  view,
  waitingOn,
} from "./game";
import type { BattleshipState, BattleshipView, Fleet, Seat } from "./game";

const PLAYERS = ["alice", "bob"];

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.values(obj as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(obj);
  }
  return obj;
}

// A square by name, the way players call them: "A1" is the top-left corner.
function sq(name: string): number {
  const row = name.charCodeAt(0) - "A".charCodeAt(0);
  return row * SIZE + Number(name.slice(1)) - 1;
}

// Every ship laid across, one to a row, down the left edge: the carrier on
// A1–A5, the battleship on B1–B4, and so on to the destroyer on E1–E2.
const ROWS_FLEET: Fleet = FLEET.map((_, i) => ({ row: i, col: 0, vertical: false }));

// Every ship stood upright, one to a column, from A1 rightwards: the carrier
// on A1–E1, the battleship on A2–D2, and so on.
const COLUMNS_FLEET: Fleet = FLEET.map((_, i) => ({ row: 0, col: i, vertical: true }));

// Every square of ROWS_FLEET, carrier first.
const ROWS_FLEET_SQUARES = (fleetCells(ROWS_FLEET) ?? []).flat();

function place(state: BattleshipState, seat: Seat, fleet: Fleet, now = 1000): BattleshipState {
  return reduce(state, { t: "place", ships: fleet }, state.players[seat], now);
}

// Both fleets down: `seat 0` in rows, `seat 1` in columns. Seed 0 has seat 0
// fire first.
function placed(seed = 0, now = 1000): BattleshipState {
  return place(place(init(PLAYERS, seed), 0, ROWS_FLEET, now), 1, COLUMNS_FLEET, now);
}

// Fires at `square` as whoever is on turn.
function fire(state: BattleshipState, square: string, now = 2000): BattleshipState {
  return reduce(state, { t: "fire", cell: sq(square) }, state.players[state.turn], now);
}

// Plays out `seat 0`'s shots at `targets`, with `seat 1` answering each one
// with a shot into the empty bottom-right corner of `seat 0`'s waters.
function volley(state: BattleshipState, targets: number[]): BattleshipState {
  const misses = Array.from({ length: CELLS }, (_, i) => CELLS - 1 - i);
  let next = state;
  for (const [i, cell] of targets.entries()) {
    if (next.winner !== null) break;
    next = reduce(next, { t: "fire", cell }, next.players[0], 2000 + i);
    if (next.winner !== null) break;
    next = reduce(next, { t: "fire", cell: misses[i] }, next.players[1], 2000 + i);
  }
  return next;
}

describe("battleship — init", () => {
  it("is deterministic for a fixed seed", () => {
    expect(init(PLAYERS, 7)).toEqual(init(PLAYERS, 7));
  });

  it("rejects a player count other than 2", () => {
    expect(() => init(["solo"], 1)).toThrow();
    expect(() => init(["a", "b", "c"], 1)).toThrow();
  });

  it("starts in the placing phase, with no fleets and no shots", () => {
    const state = init(PLAYERS, 1);
    expect(state.phase).toBe("placing");
    expect(state.fleets).toEqual([null, null]);
    expect(state.shots).toEqual([[], []]);
    expect(state.winner).toBeNull();
  });

  it("draws who fires first from the seed", () => {
    const firsts = new Set(Array.from({ length: 20 }, (_, seed) => init(PLAYERS, seed).turn));
    expect(firsts).toEqual(new Set([0, 1]));
  });
});

describe("battleship — fleet layout", () => {
  it("names squares by row letter and column number", () => {
    expect(cellName(0)).toBe("A1");
    expect(cellName(SIZE - 1)).toBe("A10");
    expect(cellName(SIZE + 2)).toBe("B3");
    expect(cellName(CELLS - 1)).toBe("J10");
  });

  it("lays a ship right from its first square, or down when vertical", () => {
    expect(shipCells({ row: 1, col: 2, vertical: false }, 3)).toEqual([
      sq("B3"),
      sq("B4"),
      sq("B5"),
    ]);
    expect(shipCells({ row: 1, col: 2, vertical: true }, 3)).toEqual([
      sq("B3"),
      sq("C3"),
      sq("D3"),
    ]);
  });

  it("rejects a ship that runs off the board", () => {
    expect(shipCells({ row: 0, col: 6, vertical: false }, 5)).toBeNull();
    expect(shipCells({ row: 0, col: 5, vertical: false }, 5)).not.toBeNull();
    expect(shipCells({ row: 7, col: 0, vertical: true }, 4)).toBeNull();
  });

  it("accepts touching ships but not overlapping ones", () => {
    expect(fleetCells(ROWS_FLEET)).not.toBeNull();
    const overlapping = ROWS_FLEET.map((ship, i) =>
      i === 1 ? { row: 0, col: 4, vertical: true } : ship,
    );
    expect(fleetCells(overlapping)).toBeNull();
  });

  it("rejects a fleet with a ship missing", () => {
    expect(fleetCells(ROWS_FLEET.slice(0, -1))).toBeNull();
  });

  it("draws a legal random fleet, deterministically from the seed", () => {
    for (let seed = 0; seed < 200; seed++) {
      const [fleet] = randomFleet(seed);
      expect(fleetCells(fleet), `seed ${seed}`).not.toBeNull();
    }
    expect(randomFleet(9)).toEqual(randomFleet(9));
    expect(randomFleet(9)[0]).not.toEqual(randomFleet(10)[0]);
  });
});

describe("battleship — placing", () => {
  it("waits on both players until each has placed", () => {
    let state = init(PLAYERS, 1);
    expect(waitingOn(state)).toEqual(["alice", "bob"]);
    state = place(state, 1, COLUMNS_FLEET);
    expect(waitingOn(state)).toEqual(["alice"]);
    expect(state.phase).toBe("placing");
  });

  it("starts firing once both fleets are down", () => {
    const state = placed(1, 5000);
    expect(state.phase).toBe("firing");
    expect(state.turnStartedAt).toBe(5000);
    expect(waitingOn(state)).toEqual([state.players[state.turn]]);
  });

  it("rejects an illegal layout and leaves the state unchanged", () => {
    const state = init(PLAYERS, 1);
    const offBoard = ROWS_FLEET.map((ship, i) => (i === 0 ? { ...ship, col: 6 } : ship));
    expect(() => place(state, 0, offBoard)).toThrow(/fit on the board/);
    expect(state).toEqual(init(PLAYERS, 1));
  });

  it("rejects placing twice", () => {
    const state = place(init(PLAYERS, 1), 0, ROWS_FLEET);
    expect(() => place(state, 0, COLUMNS_FLEET)).toThrow(/already placed/);
  });

  it("rejects a shot before both fleets are placed", () => {
    const state = place(init(PLAYERS, 1), 0, ROWS_FLEET);
    expect(() => fire(state, "A1")).toThrow(/both fleets/);
  });

  it("rejects a player from outside the match", () => {
    expect(() =>
      reduce(init(PLAYERS, 1), { t: "place", ships: ROWS_FLEET }, "mallory", 1000),
    ).toThrow(/not a player/);
  });

  it("does not mutate its input state and returns a new object", () => {
    const state = deepFreeze(init(PLAYERS, 1));
    const before = structuredClone(state);
    const next = place(state, 0, ROWS_FLEET);
    expect(state).toEqual(before);
    expect(next).not.toBe(state);
    expect(next.fleets).not.toBe(state.fleets);
  });

  it("keeps a copy of the fleet, not the action's own objects", () => {
    const fleet = ROWS_FLEET.map((ship) => ({ ...ship }));
    const state = place(init(PLAYERS, 1), 0, fleet);
    fleet[0].row = 9;
    expect(state.fleets[0]?.[0].row).toBe(0);
  });
});

describe("battleship — firing", () => {
  it("records a miss and passes the turn", () => {
    const state = placed();
    expect(state.turn).toBe(0);
    const next = fire(state, "J10", 7000);
    expect(next.shots).toEqual([[sq("J10")], []]);
    expect(next.turn).toBe(1);
    expect(next.turnNo).toBe(1);
    expect(next.lastShot).toEqual({ by: 0, cell: sq("J10") });
    expect(next.turnStartedAt).toBe(7000);
  });

  it("passes the turn after a hit too: one shot a turn", () => {
    const next = fire(placed(), "A1");
    expect(next.turn).toBe(1);
  });

  it("rejects a second shot at the same square", () => {
    const state = fire(fire(placed(), "A1"), "J10");
    expect(() => fire(state, "A1")).toThrow(/already fired/);
  });

  it("rejects an out-of-turn shot and leaves the state unchanged", () => {
    const state = placed();
    expect(() => reduce(state, { t: "fire", cell: 0 }, state.players[1], 2000)).toThrow(
      /not your turn/,
    );
    expect(state).toEqual(placed());
  });

  it("rejects a new layout once firing has started", () => {
    expect(() => place(placed(), 0, COLUMNS_FLEET)).toThrow(/already placed/);
  });

  it("wins by sinking every ship, and not a shot sooner", () => {
    const targets = (fleetCells(COLUMNS_FLEET) ?? []).flat();
    const almost = volley(placed(), targets.slice(0, -1));
    expect(almost.winner).toBeNull();
    expect(result(almost)).toBeNull();

    const done = volley(almost, targets.slice(-1));
    expect(done.winner).toBe(0);
    expect(result(done)).toEqual({ kind: "win", winners: ["alice"] });
    expect(waitingOn(done)).toEqual([]);
    expect(battleshipGame.deadline(done)).toBeNull();
    expect(() => fire(done, "J9")).toThrow(/finished/);
  });

  it("does not mutate its input state", () => {
    const state = deepFreeze(placed());
    const before = structuredClone(state);
    fire(state, "A1");
    expect(state).toEqual(before);
  });

  it("is deterministic for the same seed and actions", () => {
    const run = () => fire(fire(fire(placed(3), "A1"), "J10"), "B1");
    expect(run()).toEqual(run());
  });
});

describe("battleship — deadline", () => {
  it("has none before anyone has placed", () => {
    expect(battleshipGame.deadline(init(PLAYERS, 1))).toBeNull();
  });

  it("gives placing 24h from the first fleet", () => {
    const state = place(init(PLAYERS, 1), 0, ROWS_FLEET, 12345);
    expect(battleshipGame.deadline(state)).toBe(12345 + TURN_TIMEOUT_MS);
  });

  it("gives each shot 24h", () => {
    const state = fire(placed(1, 1000), "A1", 54321);
    expect(battleshipGame.deadline(state)).toBe(54321 + TURN_TIMEOUT_MS);
  });
});

describe("battleship — onDeadline", () => {
  function halfPlaced(seed = 1): BattleshipState {
    return place(init(PLAYERS, seed), 0, ROWS_FLEET, 1000);
  }

  it("places a random fleet for whoever has not placed, and starts firing", () => {
    const state = halfPlaced();
    const now = 1000 + TURN_TIMEOUT_MS;
    const resolved = onDeadline(state, now);
    expect(resolved.phase).toBe("firing");
    expect(resolved.fleets[0]).toEqual(ROWS_FLEET);
    expect(fleetCells(resolved.fleets[1] ?? [])).not.toBeNull();
    expect(resolved.turnStartedAt).toBe(now);
    expect(battleshipGame.deadline(resolved)).toBe(now + TURN_TIMEOUT_MS);
  });

  it("auto-fires at a square the player on turn has not fired at", () => {
    let state = fire(placed(), "A1", 1000);
    state = fire(state, "A1", 1000);
    const resolved = onDeadline(state, 1000 + TURN_TIMEOUT_MS);
    expect(resolved.turnNo).toBe(3);
    expect(resolved.shots[0]).toHaveLength(2);
    expect(resolved.shots[0][1]).not.toBe(sq("A1"));
    expect(resolved.turn).toBe(1);
  });

  it("is deterministic via the seeded PRNG", () => {
    const now = 1000 + TURN_TIMEOUT_MS;
    expect(onDeadline(halfPlaced(5), now)).toEqual(onDeadline(halfPlaced(5), now));
    expect(onDeadline(placed(5), now)).toEqual(onDeadline(placed(5), now));
  });

  it("is idempotent: applying it twice with the same now resolves exactly once", () => {
    const now = 1000 + TURN_TIMEOUT_MS + 1;
    for (const state of [halfPlaced(), placed()]) {
      const once = onDeadline(state, now);
      expect(onDeadline(once, now)).toEqual(once);
    }
  });

  it("does not mutate its input state", () => {
    const state = deepFreeze(halfPlaced());
    const before = structuredClone(state);
    onDeadline(state, 1000 + TURN_TIMEOUT_MS);
    expect(state).toEqual(before);
  });

  it("is a no-op before the deadline has passed", () => {
    const state = placed();
    expect(onDeadline(state, 1001)).toEqual(state);
  });

  it("is a no-op right after init, before anyone has placed", () => {
    const state = init(PLAYERS, 1);
    expect(onDeadline(state, 999_999_999)).toEqual(state);
  });

  it("is a no-op once the match is finished", () => {
    const state = { ...placed(), winner: 0 as const };
    expect(onDeadline(state, 1000 + TURN_TIMEOUT_MS + 1)).toEqual(state);
  });
});

describe("battleship — view()", () => {
  it("never returns the state object or its fleets", () => {
    const state = placed();
    const projected = view(state, "alice");
    expect(projected).not.toBe(state);
    expect(projected.fleets[0]).not.toBe(state.fleets[0]);
  });

  it("never sends a player the other's fleet while placing", () => {
    const state = place(init(PLAYERS, 1), 1, COLUMNS_FLEET);
    const forAlice = view(state, "alice");
    expect(forAlice.ready).toEqual([false, true]);
    expect(forAlice.fleets).toEqual([null, null]);
    expect(view(state, "bob").fleets).toEqual([null, COLUMNS_FLEET]);
  });

  it("never sends a player the other's afloat ships while firing", () => {
    const state = fire(placed(), "A1");
    const forAlice = view(state, "alice");
    const forBob = view(state, "bob");
    expect(forAlice.fleets).toEqual([ROWS_FLEET, null]);
    expect(forBob.fleets).toEqual([null, COLUMNS_FLEET]);
    // Nothing else carries a square of Bob's fleet that Alice has not fired at.
    const shown = JSON.stringify(forAlice);
    for (const key of ["row", "col", "vertical"]) {
      expect(shown.match(new RegExp(`"${key}"`, "g"))?.length).toBe(FLEET.length);
    }
  });

  it("scores each shot as a hit or a miss for both players alike", () => {
    const state = fire(fire(placed(), "A1"), "J10");
    const expected = [[{ cell: sq("A1"), hit: true }], [{ cell: sq("J10"), hit: false }]];
    expect(view(state, "alice").shots).toEqual(expected);
    expect(view(state, "bob").shots).toEqual(expected);
    expect(view(state, "alice").lastShot).toEqual({
      by: 1,
      cell: sq("J10"),
      hit: false,
      sunk: null,
    });
  });

  it("reveals a ship to both players once it is sunk, and names it on the last shot", () => {
    // Bob's destroyer stands on A5–B5.
    let state = volley(placed(), [sq("A5")]);
    expect(view(state, "alice").sunk).toEqual([[], []]);
    state = fire(state, "B5");

    const forAlice = view(state, "alice");
    expect(forAlice.lastShot).toEqual({ by: 0, cell: sq("B5"), hit: true, sunk: "destroyer" });
    expect(forAlice.sunk).toEqual([[], [{ ship: "destroyer", row: 0, col: 4, vertical: true }]]);
    expect(forAlice.fleets[1]).toBeNull();
    expect(view(state, "bob").sunk).toEqual(forAlice.sunk);
  });

  it("reveals both fleets once the match is over", () => {
    const done = volley(placed(), (fleetCells(COLUMNS_FLEET) ?? []).flat());
    const forBob = view(done, "bob");
    expect(forBob.phase).toBe("over");
    expect(forBob.fleets).toEqual([ROWS_FLEET, COLUMNS_FLEET]);
    expect(forBob.winner).toBe(0);
    expect(forBob.turn).toBeNull();
    expect(forBob.yourTurn).toBe(false);
  });

  it("tells only the player on turn that it is their turn", () => {
    const state = placed();
    expect(view(state, "alice")).toMatchObject({ you: 0, turn: 0, yourTurn: true });
    expect(view(state, "bob")).toMatchObject({ you: 1, turn: 0, yourTurn: false });
  });

  it("reports spectator for a non-player id, with no fleet at all", () => {
    const projected: BattleshipView = view(fire(placed(), "A1"), "nobody");
    expect(projected.you).toBe("spectator");
    expect(projected.yourTurn).toBe(false);
    expect(projected.fleets).toEqual([null, null]);
  });
});

describe("battleship — describeAction", () => {
  it("says a fleet was placed without naming a square of it", () => {
    const state = init(PLAYERS, 1);
    const described = describeAction(state, { t: "place", ships: ROWS_FLEET }, "alice");
    expect(described).toEqual({ key: "history.placed" });
  });

  it("names the square and whether the shot hit", () => {
    const state = placed();
    expect(describeAction(state, { t: "fire", cell: sq("J10") }, "alice")).toEqual({
      key: "history.miss",
      values: { cell: "J10" },
    });
    expect(describeAction(state, { t: "fire", cell: sq("A1") }, "alice")).toEqual({
      key: "history.hit",
      values: { cell: "A1" },
    });
  });

  it("names the ship a shot sinks", () => {
    const state = volley(placed(), [sq("A5")]);
    expect(describeAction(state, { t: "fire", cell: sq("B5") }, "alice")).toEqual({
      key: "history.sunk.destroyer",
      values: { cell: "B5" },
    });
  });

  it("judges Bob's shots against Alice's fleet", () => {
    const state = fire(placed(), "J10");
    expect(describeAction(state, { t: "fire", cell: ROWS_FLEET_SQUARES[0] }, "bob").key).toBe(
      "history.hit",
    );
    expect(describeAction(state, { t: "fire", cell: sq("J1") }, "bob").key).toBe("history.miss");
  });
});

describe("battleship — module shape", () => {
  const parse = (action: unknown) => battleshipGame.actionSchema.safeParse(action).success;

  it("validates actions with actionSchema", () => {
    expect(parse({ t: "fire", cell: 0 })).toBe(true);
    expect(parse({ t: "fire", cell: CELLS - 1 })).toBe(true);
    expect(parse({ t: "fire", cell: CELLS })).toBe(false);
    expect(parse({ t: "fire", cell: 1.5 })).toBe(false);
    expect(parse({ t: "place", ships: ROWS_FLEET })).toBe(true);
    expect(parse({ t: "place", ships: ROWS_FLEET.slice(1) })).toBe(false);
    expect(parse({ t: "place", ships: ROWS_FLEET.map((s) => ({ ...s, row: SIZE })) })).toBe(false);
    expect(parse({ t: "move", path: [0, 1] })).toBe(false);
  });

  it("has 2-2 player bounds", () => {
    expect(battleshipGame.meta.minPlayers).toBe(2);
    expect(battleshipGame.meta.maxPlayers).toBe(2);
  });
});
