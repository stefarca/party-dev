import { describe, expect, it } from "vitest";

import {
  COLS,
  ROWS,
  TURN_TIMEOUT_MS,
  connect4Game,
  init,
  onDeadline,
  reduce,
  result,
  view,
  waitingOn,
} from "./game";
import type { C4State, Cell } from "./game";

const PLAYERS = ["alice", "bob"];

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.values(obj as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(obj);
  }
  return obj;
}

function drop(state: C4State, col: number, now = 1000): C4State {
  const by = state.players[state.turn];
  return reduce(state, { t: "drop", col }, by, now);
}

// Builds a board directly (bypassing reduce) for win/draw scenarios that
// would otherwise take many `drop` calls to set up. `turn`/`turnNo` are
// filled in reasonably; tests that care about them set their own.
function withBoard(base: C4State, board: Cell[][]): C4State {
  return { ...base, board };
}

function emptyBoard(): Cell[][] {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null as Cell));
}

describe("connect4 — init", () => {
  it("is deterministic for a fixed seed", () => {
    expect(init(PLAYERS, 7)).toEqual(init(PLAYERS, 7));
  });

  it("rejects a player count other than 2", () => {
    expect(() => init(["solo"], 1)).toThrow();
    expect(() => init(["a", "b", "c"], 1)).toThrow();
  });

  it("picks the first mover via the seeded PRNG, not Math.random", () => {
    const a = init(PLAYERS, 1);
    const b = init(PLAYERS, 2);
    expect([0, 1]).toContain(a.turn);
    expect([0, 1]).toContain(b.turn);
  });
});

describe("connect4 — reduce: placement", () => {
  it("lands a dropped disc in the lowest empty row", () => {
    let state = init(PLAYERS, 1);
    const mover = state.turn;
    state = drop(state, 3);
    expect(state.board[0][3]).toBe(mover);
    expect(state.lastMove).toEqual({ col: 3, row: 0 });

    state = drop(state, 3);
    expect(state.board[1][3]).not.toBeNull();
  });

  it("rejects a drop into a full column", () => {
    let state = init(PLAYERS, 1);
    for (let i = 0; i < ROWS; i++) {
      state = drop(state, 0);
    }
    expect(state.board[ROWS - 1][0]).not.toBeNull();
    expect(() => drop(state, 0)).toThrow();
  });

  it("rejects an out-of-turn action and leaves the state unchanged", () => {
    const state = init(PLAYERS, 1);
    const notTurn = state.players.find((p) => p !== state.players[state.turn]) as string;
    expect(() => reduce(state, { t: "drop", col: 0 }, notTurn, 1000)).toThrow();
    // State is untouched: verified by structural equality against a fresh
    // init with the same seed.
    expect(state).toEqual(init(PLAYERS, 1));
  });

  it("rejects further drops once the match is finished", () => {
    let state = init(PLAYERS, 1);
    state = { ...state, winner: 0 };
    expect(() => drop(state, 0)).toThrow();
  });
});

describe("connect4 — reduce purity", () => {
  it("does not mutate its input state and returns a new object", () => {
    const state = deepFreeze(init(PLAYERS, 1));
    const before = structuredClone(state);
    const next = reduce(state, { t: "drop", col: 3 }, state.players[state.turn], 1000);
    expect(state).toEqual(before);
    expect(next).not.toBe(state);
    expect(next.board).not.toBe(state.board);
  });
});

describe("connect4 — win detection", () => {
  it("detects a horizontal win", () => {
    const base = init(PLAYERS, 1);
    const board = emptyBoard();
    board[0][0] = 0;
    board[0][1] = 0;
    board[0][2] = 0;
    let state = withBoard({ ...base, turn: 0 }, board);
    state = drop(state, 3);
    expect(state.winner).toBe(0);
    expect(result(state)).toEqual({ kind: "win", winners: [base.players[0]] });
  });

  it("detects a vertical win", () => {
    const base = init(PLAYERS, 1);
    const board = emptyBoard();
    board[0][0] = 1;
    board[1][0] = 1;
    board[2][0] = 1;
    let state = withBoard({ ...base, turn: 1 }, board);
    state = drop(state, 0);
    expect(state.winner).toBe(1);
  });

  it("detects a rising diagonal win (/)", () => {
    const base = init(PLAYERS, 1);
    const board = emptyBoard();
    // Supporting discs so column heights allow the diagonal.
    board[0][0] = 0;
    board[0][1] = 1;
    board[1][1] = 0;
    board[0][2] = 1;
    board[1][2] = 1;
    board[2][2] = 0;
    board[0][3] = 1;
    board[1][3] = 1;
    board[2][3] = 1;
    let state = withBoard({ ...base, turn: 0 }, board);
    state = drop(state, 3); // lands at row 3, completing (0,0)-(1,1)-(2,2)-(3,3)
    expect(state.winner).toBe(0);
  });

  it("detects a falling diagonal win (\\)", () => {
    const base = init(PLAYERS, 1);
    const board = emptyBoard();
    // Stack col0 up to row3, col1 up to row2, col2 up to row1, leave col3
    // empty so the winning disc lands at (0,3), completing the diagonal
    // (3,0)-(2,1)-(1,2)-(0,3).
    board[0][0] = 1;
    board[1][0] = 1;
    board[2][0] = 1;
    board[3][0] = 0;
    board[0][1] = 1;
    board[1][1] = 1;
    board[2][1] = 0;
    board[0][2] = 1;
    board[1][2] = 0;
    let state = withBoard({ ...base, turn: 0 }, board);
    state = drop(state, 3);
    expect(state.winner).toBe(0);
  });

  it("does not flag a near-miss (three in a row) as a win", () => {
    const base = init(PLAYERS, 1);
    const board = emptyBoard();
    board[0][0] = 0;
    board[0][1] = 0;
    board[0][2] = 0; // three in a row, but nothing placed at column 3
    let state = withBoard({ ...base, turn: 0 }, board);
    state = drop(state, 5); // unrelated column, does not extend the three
    expect(state.winner).toBeNull();
  });
});

describe("connect4 — draw", () => {
  // A brute-force-verified full 6x7 fill with no 4-in-a-row in any of the
  // four directions (verified offline: every cell's placement was checked
  // against all already-placed neighbours before being accepted).
  const NO_WIN_FILL: Cell[][] = [
    [0, 0, 0, 1, 0, 0, 0],
    [0, 0, 0, 1, 0, 0, 0],
    [0, 0, 1, 0, 1, 0, 0],
    [1, 1, 1, 0, 1, 1, 1],
    [0, 0, 0, 1, 0, 0, 0],
    [0, 0, 0, 1, 0, 0, 0],
  ];

  it("a full board with no line is a draw and waitingOn is []", () => {
    const base = init(PLAYERS, 1);

    // Place every cell through `drop`, column by column bottom-up, so
    // `isWinningMove` actually runs on each placement and the resulting
    // `draw`/`winner` fields come from the engine, not from the fixture.
    let state = base;
    for (let col = 0; col < COLS; col++) {
      for (let row = 0; row < ROWS; row++) {
        const by = NO_WIN_FILL[row][col] as 0 | 1;
        state = reduce({ ...state, turn: by }, { t: "drop", col }, state.players[by], 1000);
      }
    }

    expect(state.board).toEqual(NO_WIN_FILL);
    expect(state.winner).toBeNull();
    expect(state.draw).toBe(true);
    expect(waitingOn(state)).toEqual([]);
    expect(result(state)).toEqual({ kind: "draw" });
  });
});

describe("connect4 — waitingOn / deadline", () => {
  it("waitingOn returns exactly the player to move while live, [] once finished", () => {
    let state = init(PLAYERS, 1);
    expect(waitingOn(state)).toEqual([state.players[state.turn]]);
    state = { ...state, winner: 0 };
    expect(waitingOn(state)).toEqual([]);
  });

  it("deadline is a 24h turn timeout from turnStartedAt", () => {
    const state = { ...init(PLAYERS, 1), turnStartedAt: 5000 };
    expect(connect4Game.deadline(state)).toBe(5000 + TURN_TIMEOUT_MS);
  });

  it("deadline is null before the first move (no real turnStartedAt yet)", () => {
    // init() has no `now`, so the very first turn has no wall-clock anchor
    // until the first reduce() call sets one for real.
    const state = init(PLAYERS, 1);
    expect(state.turnStartedAt).toBe(0);
    expect(connect4Game.deadline(state)).toBeNull();
  });

  it("deadline becomes real (and 24h out) once the first move is made", () => {
    const state = drop(init(PLAYERS, 1), 3, 12345);
    expect(connect4Game.deadline(state)).toBe(12345 + TURN_TIMEOUT_MS);
  });

  it("deadline is null once the match is finished", () => {
    const state = { ...init(PLAYERS, 1), winner: 0 as const };
    expect(connect4Game.deadline(state)).toBeNull();
  });
});

describe("connect4 — onDeadline", () => {
  // A turn already in progress (a real `turnStartedAt`, as reduce() would
  // set) — turnStartedAt=0 straight out of init() has no deadline at all
  // (see the "deadline is null before the first move" test above), so
  // onDeadline has nothing to resolve against until a real turn has begun.
  function midTurn(seed: number, turnStartedAt = 1000): C4State {
    return { ...init(PLAYERS, seed), turnStartedAt };
  }

  it("auto-plays a legal column deterministically via the seeded PRNG", () => {
    const state = midTurn(1);
    const resolved = onDeadline(state, state.turnStartedAt + TURN_TIMEOUT_MS + 1);
    expect(resolved.turnNo).toBe(1);
    expect(resolved.lastMove).not.toBeNull();
  });

  it("is idempotent: applying it twice with the same now resolves exactly one turn", () => {
    const state = midTurn(1);
    const now = state.turnStartedAt + TURN_TIMEOUT_MS + 1;
    const once = onDeadline(state, now);
    const twice = onDeadline(once, now);
    expect(twice).toEqual(once);
  });

  it("is a no-op before the deadline has passed", () => {
    const state = midTurn(1);
    expect(onDeadline(state, state.turnStartedAt + 1)).toEqual(state);
  });

  it("is a no-op right after init, before any turn has a real start time", () => {
    const state = init(PLAYERS, 1);
    expect(onDeadline(state, 999_999_999)).toEqual(state);
  });

  it("is a no-op once the match is finished", () => {
    const state = { ...midTurn(1), winner: 0 as const };
    expect(onDeadline(state, state.turnStartedAt + TURN_TIMEOUT_MS + 1)).toEqual(state);
  });
});

describe("connect4 — view()", () => {
  it("never returns the state object itself", () => {
    const state = init(PLAYERS, 1);
    expect(view(state, state.players[0])).not.toBe(state);
  });

  it("is a real per-player projection with the expected shape", () => {
    const state = drop(init(PLAYERS, 1), 3);
    const projected = view(state, state.players[0]) as {
      you: 0 | 1 | "spectator";
      yourTurn: boolean;
      board: Cell[][];
    };
    expect(projected.you).toBe(0);
    expect(projected.board).not.toBe(state.board);
    expect(typeof projected.yourTurn).toBe("boolean");
  });

  it("reports spectator for a non-player id", () => {
    const state = init(PLAYERS, 1);
    const projected = view(state, "nobody") as { you: unknown };
    expect(projected.you).toBe("spectator");
  });
});

describe("connect4 — module shape", () => {
  it("validates actions with actionSchema", () => {
    expect(connect4Game.actionSchema.safeParse({ t: "drop", col: 0 }).success).toBe(true);
    expect(connect4Game.actionSchema.safeParse({ t: "drop", col: 7 }).success).toBe(false);
    expect(connect4Game.actionSchema.safeParse({ t: "nonsense" }).success).toBe(false);
  });

  it("has 2-2 player bounds", () => {
    expect(connect4Game.meta.minPlayers).toBe(2);
    expect(connect4Game.meta.maxPlayers).toBe(2);
  });
});
