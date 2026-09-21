import { describe, expect, test } from "vitest";

import {
  CELLS,
  COLS,
  MAX_OPENING,
  MINES,
  MinesweeperActionSchema,
  NEIGHBOURS,
  ROWS,
  countsOf,
  deal,
  init,
  minesweeperGame,
  reduce,
  score,
  solvable,
  step,
  view,
} from "./game";
import type { MinesweeperAction, MinesweeperState } from "./game";

const at = (row: number, col: number) => row * COLS + col;

// A minefield with mines on `cells` and nowhere else.
function minesAt(...cells: number[]): boolean[] {
  const mines = new Array<boolean>(CELLS).fill(false);
  for (const cell of cells) mines[cell] = true;
  return mines;
}

// A minefield drawn from its top rows, "*" for a mine; every square not drawn
// is clear.
function field(rows: string[]): boolean[] {
  return minesAt(
    ...rows.flatMap((line, row) =>
      [...line].flatMap((ch, col) => (ch === "*" ? [at(row, col)] : [])),
    ),
  );
}

function stateWith(mines: boolean[], startedAt = 1_000): MinesweeperState {
  return {
    mines,
    revealed: new Array<boolean>(CELLS).fill(false),
    flagged: new Array<boolean>(CELLS).fill(false),
    moves: 0,
    startedAt,
    clearedAt: null,
    blast: null,
  };
}

const reveal = (cell: number): MinesweeperAction => ({ t: "reveal", cell });
const chord = (cell: number): MinesweeperAction => ({ t: "chord", cell });
const flag = (cell: number, on = true): MinesweeperAction => ({ t: "flag", cell, on });

const hiddenOf = (state: MinesweeperState) =>
  state.revealed.flatMap((open, cell) => (open ? [] : [cell]));

// Four mines: one in the top-left corner, one near it, and two in the
// bottom-right corner, diagonal to each other. Opening the middle clears
// everything but those four and the two squares between the corner pair,
// which no 0 touches.
const MINED = minesAt(at(0, 0), at(2, 2), at(10, 8), at(11, 9));
const MIDDLE = at(6, 5);
const LEFT_SHUT = [at(10, 9), at(11, 8)];

function opened(startedAt = 1_000): MinesweeperState {
  return reduce(stateWith(MINED, startedAt), reveal(MIDDLE), 1_500);
}

// Whether a player can clear `mines` from `start` without ever guessing,
// worked out by exhaustive search rather than by rules, so it shares nothing
// with `solvable()`. A hidden square is settled once no way of placing mines
// that agrees with every open number puts the other thing there. No rule a
// player uses is stronger than that, so a board `solvable()` clears, this
// clears too — unless `solvable()` took something for forced that was not.
function clearsByExhaustion(mines: boolean[], start: number): boolean {
  const around = (cell: number): number[] => {
    const row = Math.floor(cell / COLS);
    const col = cell % COLS;
    const out: number[] = [];
    for (const [dRow, dCol] of [
      [-1, -1],
      [-1, 0],
      [-1, 1],
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 0],
      [1, 1],
    ]) {
      const r = row + dRow;
      const c = col + dCol;
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS) out.push(r * COLS + c);
    }
    return out;
  };
  const count = (cell: number) => around(cell).filter((other) => mines[other]).length;
  const total = mines.filter(Boolean).length;
  const open = new Array<boolean>(CELLS).fill(false);
  const flagged = new Array<boolean>(CELLS).fill(false);
  const dig = (cell: number): void => {
    if (open[cell]) return;
    if (mines[cell]) throw new Error(`dug up the mine at ${cell}`);
    open[cell] = true;
    if (count(cell) === 0) around(cell).forEach(dig);
  };

  // Whether some placing of mines on the hidden squares linked to `cell`,
  // with `cell` itself set to `mine`, agrees with every rule.
  type Rule = { hidden: number[]; need: number };
  const possible = (rules: Rule[], cell: number, mine: boolean): boolean => {
    const order = [cell];
    const linked = new Set(order);
    for (let i = 0; i < order.length; i++) {
      for (const rule of rules) {
        if (!rule.hidden.includes(order[i])) continue;
        for (const other of rule.hidden) {
          if (!linked.has(other)) {
            linked.add(other);
            order.push(other);
          }
        }
      }
    }
    const relevant = rules.filter((rule) => rule.hidden.some((other) => linked.has(other)));
    const value = new Map<number, boolean>([[cell, mine]]);
    const fits = () =>
      relevant.every((rule) => {
        let placed = 0;
        let free = 0;
        for (const other of rule.hidden) {
          const v = value.get(other);
          if (v === undefined) free++;
          else if (v) placed++;
        }
        return placed <= rule.need && placed + free >= rule.need;
      });
    const search = (i: number): boolean => {
      if (!fits()) return false;
      if (i === order.length) return true;
      for (const v of [false, true]) {
        value.set(order[i], v);
        if (search(i + 1)) return true;
      }
      value.delete(order[i]);
      return false;
    };
    return search(1);
  };

  dig(start);
  while (open.filter(Boolean).length < CELLS - total) {
    const rules: Rule[] = open.flatMap((isOpen, cell) => {
      if (!isOpen) return [];
      const hidden = around(cell).filter((other) => !open[other] && !flagged[other]);
      const flags = around(cell).filter((other) => flagged[other]).length;
      return hidden.length > 0 ? [{ hidden, need: count(cell) - flags }] : [];
    });
    const frontier = [...new Set(rules.flatMap((rule) => rule.hidden))];
    const safe = frontier.filter((cell) => !possible(rules, cell, true));
    const mined = frontier.filter((cell) => !possible(rules, cell, false));
    if (safe.length === 0 && mined.length === 0) {
      // Stuck, unless every mine is already found.
      if (flagged.filter(Boolean).length < total) return false;
      for (let cell = 0; cell < CELLS; cell++) if (!flagged[cell]) dig(cell);
      continue;
    }
    safe.forEach(dig);
    for (const cell of mined) {
      if (!mines[cell]) throw new Error(`flagged the clear square ${cell}`);
      flagged[cell] = true;
    }
  }
  return true;
}

describe("the board's geometry", () => {
  test("corners touch three squares, edges five, the rest eight, never themselves", () => {
    expect(NEIGHBOURS[at(0, 0)]).toEqual([at(0, 1), at(1, 0), at(1, 1)]);
    expect(NEIGHBOURS[at(ROWS - 1, COLS - 1)]).toHaveLength(3);
    expect(NEIGHBOURS[at(0, 4)]).toHaveLength(5);
    expect(NEIGHBOURS[at(5, 0)]).toHaveLength(5);
    expect(NEIGHBOURS[at(5, 4)]).toHaveLength(8);
    for (let cell = 0; cell < CELLS; cell++) expect(NEIGHBOURS[cell]).not.toContain(cell);
  });

  test("counts are the mines each square touches", () => {
    const counts = countsOf(MINED);
    expect(counts[at(0, 1)]).toBe(1);
    expect(counts[at(1, 1)]).toBe(2);
    expect(counts[at(10, 9)]).toBe(2);
    expect(counts[at(11, 8)]).toBe(2);
    expect(counts[MIDDLE]).toBe(0);
  });

  test("an arrow step stops at the edge", () => {
    expect(step(0, -1, 0)).toBe(0);
    expect(step(0, 0, -1)).toBe(0);
    expect(step(0, 1, 1)).toBe(at(1, 1));
    expect(step(CELLS - 1, 1, 0)).toBe(CELLS - 1);
    expect(step(at(3, COLS - 1), 0, 1)).toBe(at(3, COLS - 1));
  });
});

describe("solvable", () => {
  test("gives up on a pair it cannot tell apart", () => {
    // One mine between the top-left two squares, walled in by mines: no
    // number ever touches either, and the count cannot say which it is.
    expect(solvable(field(["*.*", "***"]), MIDDLE)).toBe(false);
  });

  test("counts the mines: once all are found, the walled-in squares are clear", () => {
    expect(solvable(field(["..*", "***"]), MIDDLE)).toBe(true);
  });

  test("the example board clears from the middle", () => {
    expect(solvable(MINED, MIDDLE)).toBe(true);
    expect(clearsByExhaustion(MINED, MIDDLE)).toBe(true);
  });

  test("the exhaustive check agrees on the walled-in pair", () => {
    expect(clearsByExhaustion(field(["*.*", "***"]), MIDDLE)).toBe(false);
    expect(clearsByExhaustion(field(["..*", "***"]), MIDDLE)).toBe(true);
  });
});

describe("the deal", () => {
  const seeds = Array.from({ length: 30 }, (_, i) => Math.imul(i + 1, 2654435761) >>> 0);

  test("lays the mines anywhere but on or around the start", () => {
    for (const seed of seeds) {
      const { mines, start } = deal(seed);
      expect(mines.filter(Boolean)).toHaveLength(MINES);
      expect(mines[start]).toBe(false);
      for (const cell of NEIGHBOURS[start]) expect(mines[cell]).toBe(false);
    }
  });

  test("every board clears from its start without a guess", () => {
    for (const seed of seeds) {
      const { mines, start } = deal(seed);
      expect(solvable(mines, start)).toBe(true);
      expect(clearsByExhaustion(mines, start)).toBe(true);
    }
  });

  test("the opening leaves at least half the board to play", () => {
    for (const seed of seeds) {
      const state = init(seed, 0);
      const open = state.revealed.filter(Boolean).length;
      expect(open).toBeLessThanOrEqual(MAX_OPENING);
      expect(open).toBeGreaterThan(NEIGHBOURS[deal(seed).start].length);
    }
  });

  test("the same seed deals the same board; seeds differ", () => {
    expect(deal(2026)).toEqual(deal(2026));
    const boards = new Set([1, 2, 3, 4, 5, 6].map((seed) => deal(seed).mines.join()));
    expect(boards.size).toBe(6);
  });

  test("init opens the start's clearing and starts the clock", () => {
    const state = init(7, 5_000);
    const { mines, start } = deal(7);
    expect(state.mines).toEqual(mines);
    expect(state.revealed[start]).toBe(true);
    for (const cell of NEIGHBOURS[start]) expect(state.revealed[cell]).toBe(true);
    expect(state.revealed.some((open, cell) => open && mines[cell])).toBe(false);
    expect(state.flagged.some(Boolean)).toBe(false);
    expect(state).toMatchObject({ moves: 0, startedAt: 5_000, clearedAt: null, blast: null });
    expect(minesweeperGame.finished(state)).toBe(false);
  });
});

describe("reduce", () => {
  test("opening a 0 opens its whole clearing, as one move", () => {
    const state = opened();
    expect(hiddenOf(state)).toEqual([at(0, 0), at(2, 2), at(10, 8), ...LEFT_SHUT, at(11, 9)]);
    expect(state.moves).toBe(1);
  });

  test("opening a number opens that square alone", () => {
    const state = reduce(stateWith(MINED), reveal(at(1, 1)), 2_000);
    expect(hiddenOf(state)).toHaveLength(CELLS - 1);
    expect(state.revealed[at(1, 1)]).toBe(true);
  });

  test("a flag keeps its square shut, and a wrong one is lifted by a clearing", () => {
    let state = reduce(stateWith(MINED), flag(MIDDLE), 2_000);
    expect(reduce(state, reveal(MIDDLE), 2_000)).toBe(state);
    state = reduce(state, flag(at(4, 0)), 2_000);
    state = reduce(state, reveal(at(4, 4)), 2_000);
    // The middle is opened by the clearing it sits in, which also proves the
    // flag on it wrong.
    expect(state.revealed[MIDDLE]).toBe(true);
    expect(state.revealed[at(4, 0)]).toBe(true);
    expect(state.flagged.some(Boolean)).toBe(false);
  });

  test("flags go up and come down, on hidden squares only, and are not moves", () => {
    const state = opened();
    const up = reduce(state, flag(at(10, 8)), 2_000);
    expect(up.flagged[at(10, 8)]).toBe(true);
    expect(reduce(up, flag(at(10, 8)), 2_000)).toBe(up);
    const down = reduce(up, flag(at(10, 8), false), 2_000);
    expect(down.flagged[at(10, 8)]).toBe(false);
    expect(reduce(state, flag(MIDDLE), 2_000)).toBe(state);
    expect(down.moves).toBe(state.moves);
  });

  test("a chord opens the rest around a number once its flags add up", () => {
    const state = opened();
    // (9,9) touches one mine, at (10,8); the other square it touches is clear.
    expect(reduce(state, chord(at(9, 9)), 2_000)).toBe(state);
    const flagged = reduce(state, flag(at(10, 8)), 2_000);
    const chorded = reduce(flagged, chord(at(9, 9)), 2_000);
    expect(chorded.revealed[at(10, 9)]).toBe(true);
    expect(chorded.moves).toBe(state.moves + 1);
    // Nothing left around it to open.
    expect(reduce(chorded, chord(at(9, 9)), 2_000)).toBe(chorded);
    // A chord on a hidden square, or on a 0, does nothing.
    expect(reduce(state, chord(at(11, 8)), 2_000)).toBe(state);
    expect(reduce(state, chord(MIDDLE), 2_000)).toBe(state);
  });

  test("a chord around a wrong flag sets off the mine it left out", () => {
    const wrong = reduce(opened(), flag(at(10, 9)), 2_000);
    const state = reduce(wrong, chord(at(9, 9)), 3_000);
    expect(state.blast).toEqual({ cell: at(10, 8), at: 3_000 });
    expect(minesweeperGame.finished(state)).toBe(true);
  });

  test("a mine ends the run, and nothing follows", () => {
    const state = reduce(opened(), reveal(at(2, 2)), 4_000);
    expect(state.blast).toEqual({ cell: at(2, 2), at: 4_000 });
    expect(state.clearedAt).toBeNull();
    expect(minesweeperGame.finished(state)).toBe(true);
    expect(() => reduce(state, reveal(at(10, 9)), 5_000)).toThrow();
  });

  test("opening the last clear square clears the board, at that move's time", () => {
    let state = opened(1_000);
    state = reduce(state, reveal(LEFT_SHUT[0]), 60_000);
    expect(state.clearedAt).toBeNull();
    state = reduce(state, reveal(LEFT_SHUT[1]), 61_500);
    expect(state.clearedAt).toBe(61_500);
    expect(minesweeperGame.finished(state)).toBe(true);
    expect(() => reduce(state, flag(at(0, 0)), 62_000)).toThrow();
  });

  test("a move that changes nothing is a no-op, not an error", () => {
    const state = opened();
    expect(reduce(state, reveal(MIDDLE), 2_000)).toBe(state);
    expect(reduce(state, flag(at(0, 0), false), 2_000)).toBe(state);
  });

  test("never mutates its input", () => {
    const state = reduce(opened(), flag(at(10, 9)), 2_000);
    const before = structuredClone(state);
    reduce(state, reveal(at(11, 8)), 2_000);
    reduce(state, flag(at(10, 9), false), 2_000);
    reduce(state, chord(at(9, 9)), 2_000);
    reduce(stateWith(MINED), reveal(MIDDLE), 2_000);
    expect(state).toEqual(before);
  });

  test("the same moves on the same day's board play out identically", () => {
    const play = () => {
      const start = init(2026, 1_000);
      const counts = countsOf(start.mines);
      // Flag every mine that touches the opening, then chord every number.
      let state = start;
      for (let cell = 0; cell < CELLS; cell++) {
        if (start.mines[cell] && NEIGHBOURS[cell].some((other) => start.revealed[other])) {
          state = reduce(state, flag(cell), 2_000 + cell);
        }
      }
      for (let cell = 0; cell < CELLS; cell++) {
        if (start.revealed[cell] && counts[cell] > 0 && !minesweeperGame.finished(state)) {
          state = reduce(state, chord(cell), 3_000 + cell);
        }
      }
      return state;
    };
    const once = play();
    expect(once.moves).toBeGreaterThan(0);
    expect(play()).toEqual(once);
  });
});

describe("view", () => {
  test("shows open squares' numbers, flags and nothing of the mines", () => {
    const state = reduce(opened(), flag(at(10, 9)), 2_000);
    const v = view(state);
    expect(Object.keys(v).sort()).toEqual(
      ["blast", "clearedAt", "moves", "squares", "startedAt"].sort(),
    );
    expect(v.squares[MIDDLE]).toBe(0);
    expect(v.squares[at(9, 9)]).toBe(1);
    expect(v.squares[at(10, 9)]).toBe("flag");
    for (const mine of [at(0, 0), at(2, 2), at(10, 8), at(11, 9)]) {
      expect(v.squares[mine]).toBe("hidden");
    }
    expect(JSON.stringify(v)).not.toContain("mines");
    expect(JSON.stringify(v)).not.toContain(`"mine"`);
  });

  test("a fresh run shows only its opening", () => {
    const state = init(99, 1_000);
    const v = view(state);
    const shown = v.squares.filter((square) => typeof square === "number");
    expect(shown).toHaveLength(state.revealed.filter(Boolean).length);
    expect(v.squares.filter((square) => square === "hidden")).toHaveLength(CELLS - shown.length);
  });

  test("a lost run shows the mine that went off, and no other", () => {
    const v = view(reduce(opened(), reveal(at(2, 2)), 4_000));
    expect(v.squares[at(2, 2)]).toBe("mine");
    expect(v.squares.filter((square) => square === "mine")).toHaveLength(1);
    expect(v.squares[at(0, 0)]).toBe("hidden");
    expect(v.squares[at(10, 8)]).toBe("hidden");
  });

  test("a cleared board shows every mine as found", () => {
    let state = opened();
    for (const cell of LEFT_SHUT) state = reduce(state, reveal(cell), 9_000);
    const v = view(state);
    for (const mine of [at(0, 0), at(2, 2), at(10, 8), at(11, 9)]) {
      expect(v.squares[mine]).toBe("flag");
    }
  });
});

describe("score", () => {
  test("a cleared board ranks by its time, and says how many moves it took", () => {
    let state = opened(1_000);
    for (const cell of LEFT_SHUT) state = reduce(state, reveal(cell), 185_000);
    expect(score(state)).toEqual({
      value: 184_000,
      detail: { key: "chart.cleared", values: { count: 3 } },
    });
    expect(minesweeperGame.meta).toMatchObject({ order: "asc", format: "duration" });
  });

  test("a lost run is unranked, and says how far it got", () => {
    const state = reduce(opened(), reveal(at(2, 2)), 4_000);
    expect(score(state)).toEqual({
      value: null,
      detail: { key: "chart.blast", values: { cleared: CELLS - 6, count: CELLS - 4 } },
    });
  });

  test("a run ended early is unranked, and says how far it got", () => {
    expect(score(opened())).toEqual({
      value: null,
      detail: { key: "chart.unfinished", values: { cleared: CELLS - 6, count: CELLS - 4 } },
    });
  });
});

test("the action schema takes a square, a flag's side, and nothing else", () => {
  expect(MinesweeperActionSchema.safeParse({ t: "reveal", cell: 0 }).success).toBe(true);
  expect(MinesweeperActionSchema.safeParse({ t: "chord", cell: CELLS - 1 }).success).toBe(true);
  expect(MinesweeperActionSchema.safeParse({ t: "flag", cell: 5, on: false }).success).toBe(true);
  expect(MinesweeperActionSchema.safeParse({ t: "flag", cell: 5 }).success).toBe(false);
  expect(MinesweeperActionSchema.safeParse({ t: "reveal", cell: CELLS }).success).toBe(false);
  expect(MinesweeperActionSchema.safeParse({ t: "reveal", cell: 1.5 }).success).toBe(false);
  expect(MinesweeperActionSchema.safeParse({ t: "sweep" }).success).toBe(false);
});
