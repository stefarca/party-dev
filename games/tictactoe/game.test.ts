import { describe, expect, it } from "vitest";

import {
  CELLS,
  TURN_TIMEOUT_MS,
  init,
  onDeadline,
  reduce,
  result,
  tictactoeGame,
  view,
  waitingOn,
} from "./game";
import type { Cell, TttState } from "./game";

const PLAYERS = ["alice", "bob"];

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.values(obj as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(obj);
  }
  return obj;
}

// Plays `cell` as whoever is on turn.
function place(state: TttState, cell: number, now = 1000): TttState {
  return reduce(state, { t: "place", cell }, state.players[state.turn], now);
}

function playAll(state: TttState, cells: number[]): TttState {
  return cells.reduce((s, cell) => place(s, cell), state);
}

describe("tictactoe — init", () => {
  it("is deterministic for a fixed seed", () => {
    expect(init(PLAYERS, 7)).toEqual(init(PLAYERS, 7));
  });

  it("rejects a player count other than 2", () => {
    expect(() => init(["solo"], 1)).toThrow();
    expect(() => init(["a", "b", "c"], 1)).toThrow();
  });

  it("gives X and O to different players, with X on turn", () => {
    const state = init(PLAYERS, 1);
    expect([state.players.X, state.players.O].sort()).toEqual([...PLAYERS].sort());
    expect(state.turn).toBe("X");
    expect(state.board).toEqual(Array.from({ length: CELLS }, () => null));
  });

  it("draws who plays X from the seed", () => {
    const xs = new Set(Array.from({ length: 20 }, (_, seed) => init(PLAYERS, seed).players.X));
    expect(xs).toEqual(new Set(PLAYERS));
  });
});

describe("tictactoe — reduce", () => {
  it("places the mover's mark and passes the turn", () => {
    let state = init(PLAYERS, 1);
    state = place(state, 4);
    expect(state.board[4]).toBe("X");
    expect(state.lastMove).toBe(4);
    expect(state.turn).toBe("O");
    expect(state.turnNo).toBe(1);

    state = place(state, 0);
    expect(state.board[0]).toBe("O");
    expect(state.turn).toBe("X");
  });

  it("rejects a move onto a taken square", () => {
    const state = place(init(PLAYERS, 1), 4);
    expect(() => place(state, 4)).toThrow();
  });

  it("rejects an out-of-turn move and leaves the state unchanged", () => {
    const state = init(PLAYERS, 1);
    expect(() => reduce(state, { t: "place", cell: 0 }, state.players.O, 1000)).toThrow();
    expect(state).toEqual(init(PLAYERS, 1));
  });

  it("rejects further moves once the match is finished", () => {
    const state = { ...init(PLAYERS, 1), winner: "X" as const };
    expect(() => place(state, 0)).toThrow();
  });

  it("does not mutate its input state and returns a new object", () => {
    const state = deepFreeze(init(PLAYERS, 1));
    const before = structuredClone(state);
    const next = place(state, 4);
    expect(state).toEqual(before);
    expect(next).not.toBe(state);
    expect(next.board).not.toBe(state.board);
  });

  it("is deterministic for the same seed and moves", () => {
    const moves = [4, 0, 8, 2, 1];
    expect(playAll(init(PLAYERS, 3), moves)).toEqual(playAll(init(PLAYERS, 3), moves));
  });
});

describe("tictactoe — win and draw", () => {
  it.each([
    ["a row", [0, 3, 1, 4, 2], [0, 1, 2]],
    ["a column", [1, 0, 4, 2, 7], [1, 4, 7]],
    ["the main diagonal", [0, 1, 4, 2, 8], [0, 4, 8]],
    ["the anti-diagonal", [2, 0, 4, 1, 6], [2, 4, 6]],
  ])("detects a win on %s", (_label, moves, line) => {
    const base = init(PLAYERS, 1);
    const state = playAll(base, moves);
    expect(state.winner).toBe("X");
    expect(state.winLine).toEqual(line);
    expect(waitingOn(state)).toEqual([]);
    expect(result(state)).toEqual({ kind: "win", winners: [base.players.X] });
  });

  it("credits O when O completes the line", () => {
    const base = init(PLAYERS, 1);
    const state = playAll(base, [0, 3, 1, 4, 8, 5]);
    expect(state.winner).toBe("O");
    expect(state.winLine).toEqual([3, 4, 5]);
    expect(result(state)).toEqual({ kind: "win", winners: [base.players.O] });
  });

  it("declares a win on the ninth move rather than a draw", () => {
    // X O X / O X O / O X X: X's last move at 8 fills the board and completes 0-4-8.
    const state = playAll(init(PLAYERS, 1), [2, 1, 4, 3, 7, 5, 0, 6, 8]);
    expect(state.board.every((c) => c !== null)).toBe(true);
    expect(state.winner).toBe("X");
    expect(state.winLine).toEqual([0, 4, 8]);
    expect(state.draw).toBe(false);
  });

  it("a full board with no line is a draw and waitingOn is []", () => {
    // X X O / O O X / X O X
    const state = playAll(init(PLAYERS, 1), [0, 2, 1, 3, 5, 4, 6, 7, 8]);
    const expected: Cell[] = ["X", "X", "O", "O", "O", "X", "X", "O", "X"];
    expect(state.board).toEqual(expected);
    expect(state.winner).toBeNull();
    expect(state.draw).toBe(true);
    expect(waitingOn(state)).toEqual([]);
    expect(result(state)).toEqual({ kind: "draw" });
  });

  it("does not flag two in a row as a win", () => {
    const state = playAll(init(PLAYERS, 1), [0, 3, 1]);
    expect(state.winner).toBeNull();
    expect(result(state)).toBeNull();
  });
});

describe("tictactoe — waitingOn / deadline", () => {
  it("waits on exactly the player to move", () => {
    let state = init(PLAYERS, 1);
    expect(waitingOn(state)).toEqual([state.players.X]);
    state = place(state, 4);
    expect(waitingOn(state)).toEqual([state.players.O]);
  });

  it("has no deadline before the first move", () => {
    expect(tictactoeGame.deadline(init(PLAYERS, 1))).toBeNull();
  });

  it("is a 24h turn timeout once a move has been made", () => {
    const state = place(init(PLAYERS, 1), 4, 12345);
    expect(tictactoeGame.deadline(state)).toBe(12345 + TURN_TIMEOUT_MS);
  });

  it("has no deadline once the match is finished", () => {
    const state = { ...place(init(PLAYERS, 1), 4, 5000), winner: "X" as const };
    expect(tictactoeGame.deadline(state)).toBeNull();
  });
});

describe("tictactoe — onDeadline", () => {
  function midTurn(seed: number): TttState {
    return place(init(PLAYERS, seed), 4, 1000);
  }

  it("auto-plays an empty square for the player on turn", () => {
    const state = midTurn(1);
    const resolved = onDeadline(state, 1000 + TURN_TIMEOUT_MS);
    expect(resolved.turnNo).toBe(2);
    expect(resolved.lastMove).not.toBeNull();
    expect(resolved.lastMove).not.toBe(4);
    expect(resolved.board[resolved.lastMove as number]).toBe("O");
  });

  it("is deterministic via the seeded PRNG", () => {
    const now = 1000 + TURN_TIMEOUT_MS;
    expect(onDeadline(midTurn(5), now)).toEqual(onDeadline(midTurn(5), now));
  });

  it("is idempotent: applying it twice with the same now resolves exactly one turn", () => {
    const now = 1000 + TURN_TIMEOUT_MS + 1;
    const once = onDeadline(midTurn(1), now);
    expect(onDeadline(once, now)).toEqual(once);
  });

  it("does not mutate its input state", () => {
    const state = deepFreeze(midTurn(1));
    const before = structuredClone(state);
    onDeadline(state, 1000 + TURN_TIMEOUT_MS);
    expect(state).toEqual(before);
  });

  it("is a no-op before the deadline has passed", () => {
    const state = midTurn(1);
    expect(onDeadline(state, 1001)).toEqual(state);
  });

  it("is a no-op right after init, before any turn has a real start time", () => {
    const state = init(PLAYERS, 1);
    expect(onDeadline(state, 999_999_999)).toEqual(state);
  });

  it("is a no-op once the match is finished", () => {
    const state = { ...midTurn(1), winner: "X" as const };
    expect(onDeadline(state, 1000 + TURN_TIMEOUT_MS + 1)).toEqual(state);
  });
});

describe("tictactoe — view()", () => {
  it("never returns the state object or its board", () => {
    const state = init(PLAYERS, 1);
    const projected = view(state, state.players.X) as { board: Cell[] };
    expect(projected).not.toBe(state);
    expect(projected.board).not.toBe(state.board);
  });

  it("tells each player their own mark and whether they are on turn", () => {
    const state = init(PLAYERS, 1);
    const forX = view(state, state.players.X) as { you: string; yourTurn: boolean };
    const forO = view(state, state.players.O) as { you: string; yourTurn: boolean };
    expect(forX).toMatchObject({ you: "X", yourTurn: true });
    expect(forO).toMatchObject({ you: "O", yourTurn: false });
  });

  it("reports spectator for a non-player id", () => {
    const projected = view(init(PLAYERS, 1), "nobody") as { you: unknown; yourTurn: boolean };
    expect(projected.you).toBe("spectator");
    expect(projected.yourTurn).toBe(false);
  });

  it("clears turn and yourTurn once the match is finished", () => {
    const state = playAll(init(PLAYERS, 1), [0, 3, 1, 4, 2]);
    const projected = view(state, state.players.O) as { turn: unknown; yourTurn: boolean };
    expect(projected.turn).toBeNull();
    expect(projected.yourTurn).toBe(false);
  });
});

describe("tictactoe — module shape", () => {
  it("validates actions with actionSchema", () => {
    expect(tictactoeGame.actionSchema.safeParse({ t: "place", cell: 0 }).success).toBe(true);
    expect(tictactoeGame.actionSchema.safeParse({ t: "place", cell: 8 }).success).toBe(true);
    expect(tictactoeGame.actionSchema.safeParse({ t: "place", cell: 9 }).success).toBe(false);
    expect(tictactoeGame.actionSchema.safeParse({ t: "place", cell: 1.5 }).success).toBe(false);
    expect(tictactoeGame.actionSchema.safeParse({ t: "drop", col: 0 }).success).toBe(false);
  });

  it("has 2-2 player bounds", () => {
    expect(tictactoeGame.meta.minPlayers).toBe(2);
    expect(tictactoeGame.meta.maxPlayers).toBe(2);
  });
});
