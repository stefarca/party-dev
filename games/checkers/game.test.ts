import { describe, expect, it } from "vitest";

import {
  QUIET_PLY_LIMIT,
  SIZE,
  SQUARES,
  TURN_TIMEOUT_MS,
  checkersGame,
  init,
  isDarkSquare,
  legalMoves,
  onDeadline,
  reduce,
  result,
  view,
  waitingOn,
} from "./game";
import type { CheckersState, Side, Square } from "./game";

const PLAYERS = ["alice", "bob"];

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.values(obj as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(obj);
  }
  return obj;
}

const at = (row: number, col: number): number => row * SIZE + col;

// Builds a board from eight 8-character rows, top row (row 0) first: `r`/`b`
// is a red/blue man, `R`/`B` a red/blue king, anything else an empty square.
function boardFrom(rows: string[]): Square[] {
  const board = rows.flatMap((line, row) =>
    [...line].map((ch, col): Square => {
      const lower = ch.toLowerCase();
      if (lower !== "r" && lower !== "b") return null;
      if (!isDarkSquare(at(row, col))) throw new Error(`piece on a light square at ${row},${col}`);
      return { side: lower === "r" ? "red" : "blue", king: ch !== lower };
    }),
  );
  if (board.length !== SQUARES) throw new Error("a board is 8 rows of 8 squares");
  return board;
}

function withBoard(rows: string[], turn: Side = "red", extra: Partial<CheckersState> = {}) {
  return { ...init(PLAYERS, 1), board: boardFrom(rows), turn, ...extra };
}

// Plays `path` as whoever is on turn.
function play(state: CheckersState, path: number[], now = 1000): CheckersState {
  return reduce(state, { t: "move", path }, state.players[state.turn], now);
}

function paths(state: CheckersState): number[][] {
  return legalMoves(state.board, state.turn).map((m) => m.path);
}

function count(board: Square[], side: Side): number {
  return board.filter((square) => square?.side === side).length;
}

describe("checkers — init", () => {
  it("is deterministic for a fixed seed", () => {
    expect(init(PLAYERS, 7)).toEqual(init(PLAYERS, 7));
  });

  it("rejects a player count other than 2", () => {
    expect(() => init(["solo"], 1)).toThrow();
    expect(() => init(["a", "b", "c"], 1)).toThrow();
  });

  it("sets out twelve men a side on the dark squares of the outer three rows", () => {
    const { board } = init(PLAYERS, 1);
    expect(count(board, "red")).toBe(12);
    expect(count(board, "blue")).toBe(12);
    board.forEach((square, i) => {
      if (square === null) return;
      const row = Math.floor(i / SIZE);
      expect(isDarkSquare(i)).toBe(true);
      expect(square.king).toBe(false);
      expect(square.side === "blue" ? row < 3 : row >= SIZE - 3).toBe(true);
    });
  });

  it("gives red and blue to different players, with red on turn", () => {
    const state = init(PLAYERS, 1);
    expect([state.players.red, state.players.blue].sort()).toEqual([...PLAYERS].sort());
    expect(state.turn).toBe("red");
  });

  it("draws who plays red from the seed", () => {
    const reds = new Set(Array.from({ length: 20 }, (_, seed) => init(PLAYERS, seed).players.red));
    expect(reds).toEqual(new Set(PLAYERS));
  });

  it("offers red the seven standard opening moves", () => {
    expect(paths(init(PLAYERS, 1))).toEqual([
      [at(5, 0), at(4, 1)],
      [at(5, 2), at(4, 1)],
      [at(5, 2), at(4, 3)],
      [at(5, 4), at(4, 3)],
      [at(5, 4), at(4, 5)],
      [at(5, 6), at(4, 5)],
      [at(5, 6), at(4, 7)],
    ]);
  });
});

describe("checkers — movement", () => {
  const LONE = [
    "........",
    "........",
    "........",
    "....b...",
    "...r....",
    "........",
    "........",
    "........",
  ];

  it("moves men one square diagonally forward only", () => {
    const board = LONE.map((line) => line.replace("b", "."));
    expect(paths(withBoard(board))).toEqual([
      [at(4, 3), at(3, 2)],
      [at(4, 3), at(3, 4)],
    ]);
    const blue = LONE.map((line) => line.replace("r", "."));
    expect(paths(withBoard(blue, "blue"))).toEqual([
      [at(3, 4), at(4, 3)],
      [at(3, 4), at(4, 5)],
    ]);
  });

  it("moves kings one square diagonally in every direction", () => {
    const board = LONE.map((line) => line.replace("b", ".").replace("r", "R"));
    expect(paths(withBoard(board))).toEqual([
      [at(4, 3), at(3, 2)],
      [at(4, 3), at(3, 4)],
      [at(4, 3), at(5, 2)],
      [at(4, 3), at(5, 4)],
    ]);
  });

  it("does not let a man capture backwards", () => {
    const board = [
      "........",
      "........",
      "........",
      "........",
      "...r....",
      "....b...",
      "........",
      "........",
    ];
    expect(paths(withBoard(board))).toEqual([
      [at(4, 3), at(3, 2)],
      [at(4, 3), at(3, 4)],
    ]);
  });

  it("passes the turn and records the move", () => {
    const state = play(init(PLAYERS, 1), [at(5, 2), at(4, 3)]);
    expect(state.board[at(5, 2)]).toBeNull();
    expect(state.board[at(4, 3)]).toEqual({ side: "red", king: false });
    expect(state.turn).toBe("blue");
    expect(state.turnNo).toBe(1);
    expect(state.lastMove).toEqual({ side: "red", path: [at(5, 2), at(4, 3)], captured: [] });
  });

  it("rejects moving onto an occupied square, off the diagonal, or the opponent's piece", () => {
    const state = init(PLAYERS, 1);
    expect(() => play(state, [at(6, 1), at(5, 2)])).toThrow(/not a legal move/);
    expect(() => play(state, [at(5, 2), at(4, 2)])).toThrow(/not a legal move/);
    expect(() => play(state, [at(2, 1), at(3, 2)])).toThrow(/not a legal move/);
  });

  it("rejects an out-of-turn move and leaves the state unchanged", () => {
    const state = init(PLAYERS, 1);
    expect(() =>
      reduce(state, { t: "move", path: [at(2, 1), at(3, 2)] }, state.players.blue, 1000),
    ).toThrow();
    expect(state).toEqual(init(PLAYERS, 1));
  });

  it("rejects further moves once the match is finished", () => {
    const state = { ...init(PLAYERS, 1), winner: "red" as const };
    expect(() => play(state, [at(5, 2), at(4, 3)])).toThrow();
  });

  it("does not mutate its input state and returns a new object", () => {
    const state = deepFreeze(init(PLAYERS, 1));
    const before = structuredClone(state);
    const next = play(state, [at(5, 2), at(4, 3)]);
    expect(state).toEqual(before);
    expect(next).not.toBe(state);
    expect(next.board).not.toBe(state.board);
  });

  it("is deterministic for the same seed and moves", () => {
    const moves = [
      [at(5, 2), at(4, 3)],
      [at(2, 5), at(3, 4)],
      [at(4, 3), at(2, 5)],
    ];
    const run = () => moves.reduce((state, path) => play(state, path), init(PLAYERS, 3));
    expect(run()).toEqual(run());
  });
});

describe("checkers — captures", () => {
  it("makes a capture mandatory", () => {
    const state = withBoard([
      "........",
      "........",
      "........",
      "....b...",
      "...r....",
      "........",
      ".....r..",
      "........",
    ]);
    expect(paths(state)).toEqual([[at(4, 3), at(2, 5)]]);
    expect(() => play(state, [at(6, 5), at(5, 4)])).toThrow(/must jump/);

    const next = play(state, [at(4, 3), at(2, 5)]);
    expect(next.board[at(3, 4)]).toBeNull();
    expect(next.lastMove?.captured).toEqual([at(3, 4)]);
  });

  it("makes a jump continue while it can, capturing every piece jumped", () => {
    const state = withBoard([
      ".......b",
      "........",
      "........",
      "....b...",
      "........",
      "..b.....",
      ".r......",
      "........",
    ]);
    const full = [at(6, 1), at(4, 3), at(2, 5)];
    expect(paths(state)).toEqual([full]);
    expect(() => play(state, [at(6, 1), at(4, 3)])).toThrow(/keep jumping/);

    const next = play(state, full);
    expect(next.board[at(5, 2)]).toBeNull();
    expect(next.board[at(3, 4)]).toBeNull();
    expect(next.board[at(2, 5)]).toEqual({ side: "red", king: false });
    expect(next.lastMove?.captured).toEqual([at(5, 2), at(3, 4)]);
    expect(next.winner).toBeNull();
  });

  it("lets the mover pick any capture, not only the longest", () => {
    const state = withBoard([
      ".......b",
      "........",
      "........",
      "......b.",
      "........",
      "..b.b...",
      "...r....",
      "........",
    ]);
    expect(paths(state)).toEqual([
      [at(6, 3), at(4, 1)],
      [at(6, 3), at(4, 5), at(2, 7)],
    ]);
    const next = play(state, [at(6, 3), at(4, 1)]);
    expect(next.lastMove?.captured).toEqual([at(5, 2)]);
  });

  it("lets a king jump backwards", () => {
    const state = withBoard([
      ".......b",
      "........",
      "........",
      "....R...",
      ".....b..",
      "........",
      "........",
      "........",
    ]);
    expect(paths(state)).toEqual([[at(3, 4), at(5, 6)]]);
  });

  it("never jumps a piece twice, and lets a king loop back to its own square", () => {
    const state = withBoard([
      "........",
      "........",
      ".b.b....",
      "........",
      ".b.b....",
      "..R.....",
      "........",
      "........",
    ]);
    expect(legalMoves(state.board, "red")).toEqual([
      {
        path: [at(5, 2), at(3, 0), at(1, 2), at(3, 4), at(5, 2)],
        captured: [at(4, 1), at(2, 1), at(2, 3), at(4, 3)],
      },
      {
        path: [at(5, 2), at(3, 4), at(1, 2), at(3, 0), at(5, 2)],
        captured: [at(4, 3), at(2, 3), at(2, 1), at(4, 1)],
      },
    ]);
  });
});

describe("checkers — crowning", () => {
  it("crowns a man that steps onto the far row", () => {
    const state = withBoard([
      "........",
      "..r.....",
      "........",
      "........",
      "........",
      "........",
      ".....b..",
      "........",
    ]);
    const next = play(state, [at(1, 2), at(0, 1)]);
    expect(next.board[at(0, 1)]).toEqual({ side: "red", king: true });

    const blue = play(next, [at(6, 5), at(7, 4)]);
    expect(blue.board[at(7, 4)]).toEqual({ side: "blue", king: true });
  });

  it("ends a man's jump when it is crowned, even if a king could jump on", () => {
    const board = [
      "........",
      "..b.b...",
      ".r......",
      "........",
      "........",
      "........",
      "........",
      "........",
    ];
    const state = withBoard(board);
    expect(paths(state)).toEqual([[at(2, 1), at(0, 3)]]);
    const next = play(state, [at(2, 1), at(0, 3)]);
    expect(next.board[at(0, 3)]).toEqual({ side: "red", king: true });
    expect(next.board[at(1, 4)]).toEqual({ side: "blue", king: false });
    expect(next.turn).toBe("blue");

    // A piece that was already a king jumps straight on through the far row.
    const king = withBoard(board.map((line) => line.replace("r", "R")));
    expect(paths(king)).toEqual([[at(2, 1), at(0, 3), at(2, 5)]]);
  });
});

describe("checkers — win and draw", () => {
  it("wins by capturing the opponent's last piece", () => {
    const base = withBoard([
      "........",
      "........",
      "........",
      "....b...",
      "...r....",
      "........",
      "........",
      "........",
    ]);
    const state = play(base, [at(4, 3), at(2, 5)]);
    expect(state.winner).toBe("red");
    expect(waitingOn(state)).toEqual([]);
    expect(result(state)).toEqual({ kind: "win", winners: [base.players.red] });
  });

  it("credits blue when blue takes the last red piece", () => {
    const base = withBoard(
      [
        "........",
        "........",
        "........",
        "....b...",
        "...r....",
        "........",
        "........",
        "........",
      ],
      "blue",
    );
    const state = play(base, [at(3, 4), at(5, 2)]);
    expect(state.winner).toBe("blue");
    expect(result(state)).toEqual({ kind: "win", winners: [base.players.blue] });
  });

  it("wins by leaving the opponent with no legal move", () => {
    const base = withBoard([
      "........",
      "........",
      "........",
      "........",
      "........",
      "r.r.....",
      ".b......",
      "r.r.....",
    ]);
    const state = play(base, [at(5, 2), at(4, 3)]);
    expect(count(state.board, "blue")).toBe(1);
    expect(state.winner).toBe("red");
    expect(result(state)).toEqual({ kind: "win", winners: [base.players.red] });
  });

  describe("the 40-move rule", () => {
    const KINGS = [
      "........",
      "..B.....",
      "........",
      "........",
      "...R....",
      "........",
      "........",
      "........",
    ];

    it("counts consecutive king moves without a capture", () => {
      const state = play(withBoard(KINGS, "red", { quietPlies: 5 }), [at(4, 3), at(3, 4)]);
      expect(state.quietPlies).toBe(6);
      expect(state.draw).toBe(false);
    });

    it("draws once each side has made forty such moves", () => {
      const base = withBoard(KINGS, "red", { quietPlies: QUIET_PLY_LIMIT - 1 });
      const state = play(base, [at(4, 3), at(3, 4)]);
      expect(state.draw).toBe(true);
      expect(state.winner).toBeNull();
      expect(waitingOn(state)).toEqual([]);
      expect(result(state)).toEqual({ kind: "draw" });
    });

    it("restarts the count when a man moves", () => {
      const board = KINGS.map((line) => line.replace("R", "r"));
      const state = play(withBoard(board, "red", { quietPlies: 50 }), [at(4, 3), at(3, 4)]);
      expect(state.quietPlies).toBe(0);
    });

    it("restarts the count on a capture", () => {
      const state = withBoard(
        [
          "........",
          "..B.....",
          "........",
          "....b...",
          "...R....",
          "........",
          "........",
          "........",
        ],
        "red",
        { quietPlies: 50 },
      );
      expect(play(state, [at(4, 3), at(2, 5)]).quietPlies).toBe(0);
    });

    it("lets a win on the limiting move beat the draw", () => {
      const base = withBoard(
        [
          "........",
          "........",
          "........",
          "........",
          "........",
          "r.R.....",
          ".b......",
          "r.r.....",
        ],
        "red",
        { quietPlies: QUIET_PLY_LIMIT - 1 },
      );
      const state = play(base, [at(5, 2), at(4, 3)]);
      expect(state.quietPlies).toBe(QUIET_PLY_LIMIT);
      expect(state.winner).toBe("red");
      expect(state.draw).toBe(false);
    });
  });
});

describe("checkers — waitingOn / deadline", () => {
  it("waits on exactly the player to move", () => {
    let state = init(PLAYERS, 1);
    expect(waitingOn(state)).toEqual([state.players.red]);
    state = play(state, [at(5, 2), at(4, 3)]);
    expect(waitingOn(state)).toEqual([state.players.blue]);
  });

  it("has no deadline before the first move", () => {
    expect(checkersGame.deadline(init(PLAYERS, 1))).toBeNull();
  });

  it("is a 24h turn timeout once a move has been made", () => {
    const state = play(init(PLAYERS, 1), [at(5, 2), at(4, 3)], 12345);
    expect(checkersGame.deadline(state)).toBe(12345 + TURN_TIMEOUT_MS);
  });

  it("has no deadline once the match is finished", () => {
    const state = { ...play(init(PLAYERS, 1), [at(5, 2), at(4, 3)], 5000), draw: true };
    expect(checkersGame.deadline(state)).toBeNull();
  });
});

describe("checkers — onDeadline", () => {
  function midTurn(seed: number): CheckersState {
    return play(init(PLAYERS, seed), [at(5, 2), at(4, 3)], 1000);
  }

  it("auto-plays a legal move for the player on turn", () => {
    const state = midTurn(1);
    const legal = paths(state);
    const resolved = onDeadline(state, 1000 + TURN_TIMEOUT_MS);
    expect(resolved.turnNo).toBe(2);
    expect(resolved.lastMove?.side).toBe("blue");
    expect(legal).toContainEqual(resolved.lastMove?.path);
  });

  it("takes a mandatory capture", () => {
    const state = withBoard(
      [
        "........",
        "........",
        "........",
        "....b...",
        "...r....",
        "........",
        ".....r..",
        "........",
      ],
      "red",
      { turnStartedAt: 1000 },
    );
    const resolved = onDeadline(state, 1000 + TURN_TIMEOUT_MS);
    expect(resolved.lastMove?.path).toEqual([at(4, 3), at(2, 5)]);
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
    const state = { ...midTurn(1), winner: "red" as const };
    expect(onDeadline(state, 1000 + TURN_TIMEOUT_MS + 1)).toEqual(state);
  });
});

describe("checkers — view()", () => {
  interface Projected {
    board: Square[];
    you: string;
    turn: Side | null;
    yourTurn: boolean;
    moves: number[][];
    mustJump: boolean;
  }

  it("never returns the state object or its board", () => {
    const state = init(PLAYERS, 1);
    const projected = view(state, state.players.red) as Projected;
    expect(projected).not.toBe(state);
    expect(projected.board).not.toBe(state.board);
  });

  it("tells each player their side, and sends legal moves only to the player on turn", () => {
    const state = init(PLAYERS, 1);
    const forRed = view(state, state.players.red) as Projected;
    const forBlue = view(state, state.players.blue) as Projected;
    expect(forRed).toMatchObject({ you: "red", yourTurn: true, mustJump: false });
    expect(forRed.moves).toEqual(paths(state));
    expect(forBlue).toMatchObject({ you: "blue", yourTurn: false, moves: [], mustJump: false });
  });

  it("flags a turn where a capture is mandatory", () => {
    const state = withBoard([
      "........",
      "........",
      "........",
      "....b...",
      "...r....",
      "........",
      "........",
      "........",
    ]);
    const projected = view(state, state.players.red) as Projected;
    expect(projected.mustJump).toBe(true);
    expect(projected.moves).toEqual([[at(4, 3), at(2, 5)]]);
  });

  it("reports spectator for a non-player id", () => {
    const projected = view(init(PLAYERS, 1), "nobody") as Projected;
    expect(projected.you).toBe("spectator");
    expect(projected.yourTurn).toBe(false);
    expect(projected.moves).toEqual([]);
  });

  it("clears turn, yourTurn and moves once the match is finished", () => {
    const state = { ...init(PLAYERS, 1), draw: true };
    const projected = view(state, state.players.red) as Projected;
    expect(projected.turn).toBeNull();
    expect(projected.yourTurn).toBe(false);
    expect(projected.moves).toEqual([]);
  });
});

describe("checkers — module shape", () => {
  const parse = (action: unknown) => checkersGame.actionSchema.safeParse(action).success;

  it("validates actions with actionSchema", () => {
    expect(parse({ t: "move", path: [at(5, 2), at(4, 3)] })).toBe(true);
    expect(parse({ t: "move", path: Array.from({ length: 13 }, () => 0) })).toBe(true);
    expect(parse({ t: "move", path: [at(5, 2)] })).toBe(false);
    expect(parse({ t: "move", path: Array.from({ length: 14 }, () => 0) })).toBe(false);
    expect(parse({ t: "move", path: [0, SQUARES] })).toBe(false);
    expect(parse({ t: "move", path: [0, 1.5] })).toBe(false);
    expect(parse({ t: "place", cell: 0 })).toBe(false);
  });

  it("has 2-2 player bounds", () => {
    expect(checkersGame.meta.minPlayers).toBe(2);
    expect(checkersGame.meta.maxPlayers).toBe(2);
  });
});
