import { describe, expect, test } from "vitest";

import {
  CELLS,
  G2048ActionSchema,
  bestTile,
  boardOf,
  g2048Game,
  hasMove,
  init,
  reduce,
  score,
  slide,
  view,
} from "./game";
import type { Board, Direction, G2048State } from "./game";

// A board from rows of values, 0 for an empty cell. Ids are handed out in
// reading order, so a test can say which tile it means.
function boardFrom(rows: number[][]): Board {
  let id = 1;
  return rows.flat().map((value) => (value === 0 ? null : { id: id++, value }));
}

function values(board: Board): number[][] {
  const out: number[][] = [];
  for (let row = 0; row < 4; row++) {
    out.push(board.slice(row * 4, row * 4 + 4).map((tile) => tile?.value ?? 0));
  }
  return out;
}

function stateWith(rows: number[][], rng = 12345): G2048State {
  return {
    board: boardFrom(rows),
    score: 0,
    moves: 0,
    over: false,
    nextId: 100,
    rng,
    last: null,
  };
}

const move = (dir: Direction) => ({ t: "move" as const, dir });

describe("slide", () => {
  test.each<[string, number[], number[], number]>([
    ["packs tiles against the edge", [0, 2, 0, 4], [2, 4, 0, 0], 0],
    ["merges a pair", [2, 2, 0, 0], [4, 0, 0, 0], 4],
    ["merges across a gap", [2, 0, 0, 2], [4, 0, 0, 0], 4],
    ["merges two pairs, never into one tile", [2, 2, 2, 2], [4, 4, 0, 0], 8],
    ["does not merge a tile made this slide", [2, 2, 4, 0], [4, 4, 0, 0], 4],
    ["merges from the edge it slides to", [4, 4, 4, 0], [8, 4, 0, 0], 8],
    ["leaves unequal neighbours alone", [2, 4, 8, 16], [2, 4, 8, 16], 0],
  ])("left: %s", (_, row, expected, gained) => {
    const result = slide(boardFrom([row, [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), "left");
    expect(values(result.board)[0]).toEqual(expected);
    expect(result.gained).toBe(gained);
  });

  test("each direction slides towards its own edge", () => {
    const board = boardFrom([
      [2, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [2, 0, 0, 4],
    ]);
    expect(values(slide(board, "right").board)).toEqual([
      [0, 0, 0, 2],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 2, 4],
    ]);
    expect(values(slide(board, "up").board)).toEqual([
      [4, 0, 0, 4],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(values(slide(board, "down").board)).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [4, 0, 0, 4],
    ]);
  });

  test("the tile nearer the edge keeps its id and absorbs the other", () => {
    // Ids in reading order: the 2 at column 3 is tile 1, the 2 at column 4 is tile 2.
    const board = boardFrom([
      [0, 0, 2, 2],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const right = slide(board, "right");
    expect(right.board[3]).toEqual({ id: 2, value: 4 });
    expect(right.merged).toEqual([2]);
    expect(right.absorbed).toEqual([{ id: 1, value: 2, cell: 3 }]);

    const left = slide(board, "left");
    expect(left.board[0]).toEqual({ id: 1, value: 4 });
    expect(left.absorbed).toEqual([{ id: 2, value: 2, cell: 0 }]);
  });

  test("reports whether anything moved", () => {
    const board = boardFrom([
      [2, 4, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(slide(board, "left").moved).toBe(false);
    expect(slide(board, "up").moved).toBe(false);
    expect(slide(board, "right").moved).toBe(true);
    expect(slide(board, "down").moved).toBe(true);
  });
});

describe("hasMove", () => {
  test("is true with an empty cell, or two equal neighbours", () => {
    expect(
      hasMove(
        boardFrom([
          [2, 4, 2, 4],
          [4, 2, 4, 2],
          [2, 4, 2, 4],
          [4, 2, 4, 0],
        ]),
      ),
    ).toBe(true);
    expect(
      hasMove(
        boardFrom([
          [2, 4, 2, 4],
          [4, 2, 4, 2],
          [2, 4, 2, 4],
          [4, 2, 8, 8],
        ]),
      ),
    ).toBe(true);
    expect(
      hasMove(
        boardFrom([
          [2, 4, 2, 4],
          [4, 2, 4, 2],
          [2, 4, 2, 4],
          [4, 2, 4, 4],
        ]),
      ),
    ).toBe(true);
  });

  test("is false on a full board with no equal neighbours", () => {
    expect(
      hasMove(
        boardFrom([
          [2, 4, 2, 4],
          [4, 2, 4, 2],
          [2, 4, 2, 4],
          [4, 2, 4, 2],
        ]),
      ),
    ).toBe(false);
  });
});

describe("init", () => {
  test("opens with two tiles, each a 2 or a 4", () => {
    const tiles = init(7).board.filter((tile) => tile !== null);
    expect(tiles).toHaveLength(2);
    for (const tile of tiles) expect([2, 4]).toContain(tile!.value);
  });

  test("the same seed deals the same board; seeds differ", () => {
    expect(init(42)).toEqual(init(42));
    const boards = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => JSON.stringify(init(seed).board)),
    );
    expect(boards.size).toBeGreaterThan(1);
  });
});

describe("reduce", () => {
  test("slides, scores the merge and spawns one tile", () => {
    const state = stateWith([
      [2, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const next = reduce(state, move("left"));
    expect(next.score).toBe(4);
    expect(next.moves).toBe(1);
    expect(next.board[0]).toEqual({ id: 1, value: 4 });
    expect(next.board.filter((tile) => tile !== null)).toHaveLength(2);
    expect(next.last).toEqual({
      merged: [1],
      absorbed: [{ id: 2, value: 2, cell: 0 }],
      spawned: 100,
    });
    expect(next.nextId).toBe(101);
    expect(next.rng).not.toBe(state.rng);
  });

  test("a slide that moves nothing changes nothing", () => {
    const state = stateWith([
      [2, 4, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(reduce(state, move("left"))).toBe(state);
  });

  test("ends the run once the new tile leaves no move", () => {
    // Sliding right opens the top-left corner, the only empty cell, and
    // whichever of 2 or 4 spawns there leaves every neighbour unequal.
    const state = stateWith([
      [8, 16, 8, 0],
      [16, 32, 64, 16],
      [8, 16, 8, 32],
      [16, 8, 16, 8],
    ]);
    const slid = reduce(state, move("right"));
    expect(slid.moves).toBe(1);
    expect(slid.over).toBe(true);
    expect(() => reduce(slid, move("left"))).toThrow();
  });

  test("never mutates its input", () => {
    const state = stateWith([
      [2, 2, 4, 0],
      [0, 4, 0, 0],
      [0, 0, 0, 0],
      [8, 0, 0, 8],
    ]);
    const before = structuredClone(state);
    reduce(state, move("right"));
    reduce(state, move("down"));
    expect(state).toEqual(before);
  });

  test("the same moves from the same seed play out identically", () => {
    const moves: Direction[] = ["left", "up", "right", "down", "left", "left", "up", "right"];
    const play = () => moves.reduce((state, dir) => reduce(state, move(dir)), init(2026));
    expect(play()).toEqual(play());
  });
});

describe("view", () => {
  test("shows the board and the numbers, never the PRNG state", () => {
    const state = reduce(init(99), move("left"));
    const v = view(reduce(state, move("up")));
    expect(JSON.stringify(v)).not.toContain(`"rng"`);
    expect(v).not.toHaveProperty("rng");
    expect(v).not.toHaveProperty("nextId");
    expect(v.tiles.length).toBeGreaterThan(0);
  });

  test("lists every tile once, in id order, and the board rebuilds from it", () => {
    const state = stateWith([
      [0, 4, 0, 2],
      [0, 0, 8, 0],
      [0, 0, 0, 0],
      [2, 0, 0, 0],
    ]);
    const v = view(state);
    expect(v.tiles.map((tile) => tile.id)).toEqual([1, 2, 3, 4]);
    expect(v.best).toBe(8);
    expect(boardOf(v.tiles)).toEqual(state.board);
  });
});

describe("score", () => {
  test("ranks by points, and describes the best tile and the moves", () => {
    const state: G2048State = {
      ...stateWith([
        [128, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 2],
      ]),
      score: 1204,
      moves: 97,
    };
    expect(score(state)).toEqual({
      value: 1204,
      detail: { key: "chart.detail", values: { tile: 128, count: 97 } },
    });
    expect(bestTile(state.board)).toBe(128);
    expect(g2048Game.meta.order).toBe("desc");
  });

  test("the run is finished exactly when the board is stuck", () => {
    expect(g2048Game.finished(init(1))).toBe(false);
    expect(g2048Game.finished({ ...init(1), over: true })).toBe(true);
  });
});

test("the action schema accepts the four directions and nothing else", () => {
  for (const dir of ["up", "down", "left", "right"]) {
    expect(G2048ActionSchema.safeParse({ t: "move", dir }).success).toBe(true);
  }
  expect(G2048ActionSchema.safeParse({ t: "move", dir: "diagonal" }).success).toBe(false);
  expect(G2048ActionSchema.safeParse({ t: "undo" }).success).toBe(false);
});

test("a board has 16 cells", () => {
  expect(init(3).board).toHaveLength(CELLS);
});
