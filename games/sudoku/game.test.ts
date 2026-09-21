import { describe, expect, test } from "vitest";

import {
  CELLS,
  PEERS,
  SudokuActionSchema,
  UNITS,
  clashes,
  deal,
  fillGrid,
  init,
  isSolved,
  reduce,
  score,
  solveBySingles,
  step,
  sudokuGame,
  valuesOf,
  view,
} from "./game";
import type { SudokuAction, SudokuState } from "./game";

// A grid from 9 strings of 9 characters, "." or "0" for an empty square.
function grid(rows: string[]): number[] {
  return rows
    .join("")
    .split("")
    .map((ch) => (ch === "." ? 0 : Number(ch)));
}

const SOLUTION = grid([
  "534678912",
  "672195348",
  "198342567",
  "859761423",
  "426853791",
  "713924856",
  "961537284",
  "287419635",
  "345286179",
]);

const PUZZLE = grid([
  "53..7....",
  "6..195...",
  ".98....6.",
  "8...6...3",
  "4..8.3..1",
  "7...2...6",
  ".6....28.",
  "...419..5",
  "....8..79",
]);

function stateWith(givens: number[], startedAt = 1_000): SudokuState {
  return {
    givens,
    entries: new Array<number>(CELLS).fill(0),
    notes: new Array<number>(CELLS).fill(0),
    moves: 0,
    startedAt,
    solvedAt: null,
  };
}

// Counts the puzzle's solutions, stopping at `limit`. A plain backtracking
// search that shares nothing with the module's own solver, so it can check
// that solver's claim that a dealt puzzle has exactly one.
function countSolutions(puzzle: readonly number[], limit = 2): number {
  const cells = puzzle.slice();
  const fits = (cell: number, digit: number) => {
    const row = Math.floor(cell / 9);
    const col = cell % 9;
    for (let i = 0; i < 9; i++) {
      if (cells[row * 9 + i] === digit || cells[i * 9 + col] === digit) return false;
    }
    const top = row - (row % 3);
    const left = col - (col % 3);
    for (let r = top; r < top + 3; r++) {
      for (let c = left; c < left + 3; c++) if (cells[r * 9 + c] === digit) return false;
    }
    return true;
  };
  let found = 0;
  const search = (from: number): void => {
    const cell = cells.indexOf(0, from);
    if (cell === -1) {
      found++;
      return;
    }
    for (let digit = 1; digit <= 9 && found < limit; digit++) {
      if (!fits(cell, digit)) continue;
      cells[cell] = digit;
      search(cell + 1);
      cells[cell] = 0;
    }
  };
  search(0);
  return found;
}

// Plays every missing digit of `state`'s puzzle from `solution`, one move
// each, all at `now`.
function solve(state: SudokuState, solution: number[], now: number): SudokuState {
  return solution.reduce(
    (next, digit, cell) =>
      state.givens[cell] === 0 ? reduce(next, { t: "set", cell, digit }, now) : next,
    state,
  );
}

describe("the board's geometry", () => {
  test("27 units of 9 cells, every cell in exactly three", () => {
    expect(UNITS).toHaveLength(27);
    const seen = new Array<number>(CELLS).fill(0);
    for (const unit of UNITS) {
      expect(new Set(unit).size).toBe(9);
      for (const cell of unit) seen[cell]++;
    }
    expect(seen.every((count) => count === 3)).toBe(true);
  });

  test("every cell has 20 peers, never itself", () => {
    for (let cell = 0; cell < CELLS; cell++) {
      expect(PEERS[cell]).toHaveLength(20);
      expect(PEERS[cell]).not.toContain(cell);
    }
    // Row 0, column 0: the rest of its row, its column and its box.
    expect(PEERS[0]).toEqual(expect.arrayContaining([1, 8, 9, 72, 10, 11, 19, 20]));
    expect(PEERS[0]).not.toContain(12);
  });

  test("an arrow step stops at the edge", () => {
    expect(step(0, -1, 0)).toBe(0);
    expect(step(0, 0, -1)).toBe(0);
    expect(step(0, 1, 1)).toBe(10);
    expect(step(80, 1, 0)).toBe(80);
    expect(step(40, 0, 1)).toBe(41);
  });
});

describe("clashes and isSolved", () => {
  test("a solution has no clashes and is solved", () => {
    expect(clashes(SOLUTION).some(Boolean)).toBe(false);
    expect(isSolved(SOLUTION)).toBe(true);
  });

  test("marks both cells of a clash, in a row, a column or a box", () => {
    const row = new Array<number>(CELLS).fill(0);
    row[0] = 5;
    row[8] = 5;
    expect(clashes(row).flatMap((clash, cell) => (clash ? [cell] : []))).toEqual([0, 8]);

    const box = new Array<number>(CELLS).fill(0);
    box[0] = 3;
    box[20] = 3;
    expect(clashes(box).flatMap((clash, cell) => (clash ? [cell] : []))).toEqual([0, 20]);
  });

  test("a full grid with a clash is not solved, nor is one with a gap", () => {
    const swapped = SOLUTION.slice();
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    expect(isSolved(swapped)).toBe(false);
    const gap = SOLUTION.slice();
    gap[40] = 0;
    expect(isSolved(gap)).toBe(false);
  });
});

describe("solveBySingles", () => {
  test("solves a puzzle singles can crack", () => {
    expect(solveBySingles(PUZZLE)).toEqual(SOLUTION);
  });

  test("gives up where singles run out", () => {
    // A well-known puzzle with one solution that singles alone never reach.
    const hard = grid([
      "8........",
      "..36.....",
      ".7..9.2..",
      ".5...7...",
      "....457..",
      "...1...3.",
      "..1....68",
      "..85...1.",
      ".9....4..",
    ]);
    expect(solveBySingles(hard)).toBeNull();
    expect(solveBySingles(new Array<number>(CELLS).fill(0))).toBeNull();
  });

  test("refuses a grid whose givens already clash", () => {
    const clashing = PUZZLE.slice();
    clashing[2] = 5; // row 0 already has a 5
    expect(solveBySingles(clashing)).toBeNull();
  });
});

describe("the deal", () => {
  test("fills a complete, valid grid from any seed", () => {
    for (const seed of [0, 1, 42, 2026, 0xffffffff]) {
      const [full] = fillGrid(seed);
      expect(isSolved(full)).toBe(true);
    }
  });

  test("every puzzle has exactly one solution, which singles reach", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const puzzle = deal(Math.imul(seed, 2654435761) >>> 0);
      expect(clashes(puzzle).some(Boolean)).toBe(false);
      expect(countSolutions(puzzle)).toBe(1);
      const solved = solveBySingles(puzzle);
      expect(solved && isSolved(solved)).toBe(true);
    }
  });

  test("is symmetric through the centre and leaves a fair number of givens", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const puzzle = deal(seed * 7919);
      for (let cell = 0; cell < CELLS; cell++) {
        expect(puzzle[cell] === 0).toBe(puzzle[CELLS - 1 - cell] === 0);
      }
      const givens = puzzle.filter((digit) => digit !== 0).length;
      expect(givens).toBeGreaterThanOrEqual(17);
      expect(givens).toBeLessThan(40);
    }
  });

  test("the same seed deals the same puzzle; seeds differ", () => {
    expect(deal(2026)).toEqual(deal(2026));
    const puzzles = new Set([1, 2, 3, 4, 5, 6].map((seed) => deal(seed).join("")));
    expect(puzzles.size).toBe(6);
  });

  test("init starts the clock and an empty board", () => {
    const state = init(7, 5_000);
    expect(state.givens).toEqual(deal(7));
    expect(state.entries.every((digit) => digit === 0)).toBe(true);
    expect(state.notes.every((mask) => mask === 0)).toBe(true);
    expect(state).toMatchObject({ moves: 0, startedAt: 5_000, solvedAt: null });
  });
});

describe("reduce", () => {
  const set = (cell: number, digit: number): SudokuAction => ({ t: "set", cell, digit });
  const note = (cell: number, digit: number): SudokuAction => ({ t: "note", cell, digit });
  const clear = (cell: number): SudokuAction => ({ t: "clear", cell });

  test("enters, replaces and erases a digit, counting each as a move", () => {
    let state = stateWith(PUZZLE);
    state = reduce(state, set(2, 4), 2_000);
    expect(state.entries[2]).toBe(4);
    state = reduce(state, set(2, 1), 2_000);
    expect(state.entries[2]).toBe(1);
    state = reduce(state, clear(2), 2_000);
    expect(state.entries[2]).toBe(0);
    expect(state.moves).toBe(3);
  });

  test("a digit may clash: the board shows it, the rules allow it", () => {
    const state = reduce(stateWith(PUZZLE), set(2, 5), 2_000);
    expect(state.entries[2]).toBe(5);
    expect(clashes(valuesOf(state))[2]).toBe(true);
    expect(clashes(valuesOf(state))[0]).toBe(true);
  });

  test("notes toggle, and clear erases them once the square has no digit", () => {
    let state = stateWith(PUZZLE);
    state = reduce(state, note(2, 1), 2_000);
    state = reduce(state, note(2, 4), 2_000);
    expect(state.notes[2]).toBe(0b1001);
    state = reduce(state, note(2, 1), 2_000);
    expect(state.notes[2]).toBe(0b1000);
    state = reduce(state, clear(2), 2_000);
    expect(state.notes[2]).toBe(0);
    expect(state.moves).toBe(0);
  });

  test("entering a digit clears the square's notes and that digit from its peers'", () => {
    let state = stateWith(PUZZLE);
    for (const [cell, digit] of [
      [3, 4],
      [3, 2],
      [10, 4], // same box as cell 2
      [47, 4], // same column as cell 2
      [30, 4], // shares nothing with cell 2
    ] as const) {
      state = reduce(state, note(cell, digit), 2_000);
    }
    state = reduce(state, note(2, 1), 2_000);
    state = reduce(state, set(2, 4), 2_000);
    expect(state.notes[2]).toBe(0);
    expect(state.notes[3]).toBe(0b10);
    expect(state.notes[10]).toBe(0);
    expect(state.notes[47]).toBe(0);
    expect(state.notes[30]).toBe(0b1000);
  });

  test("a move that changes nothing is a no-op, not an error", () => {
    const empty = stateWith(PUZZLE);
    expect(reduce(empty, clear(2), 2_000)).toBe(empty);
    const filled = reduce(empty, set(2, 4), 2_000);
    expect(reduce(filled, set(2, 4), 2_000)).toBe(filled);
    expect(reduce(filled, note(2, 7), 2_000)).toBe(filled);
  });

  test("refuses to touch a given", () => {
    const state = stateWith(PUZZLE);
    expect(() => reduce(state, set(0, 1), 2_000)).toThrow();
    expect(() => reduce(state, clear(0), 2_000)).toThrow();
    expect(() => reduce(state, note(0, 1), 2_000)).toThrow();
  });

  test("the last right digit solves it, at that move's time, and nothing follows", () => {
    const solved = solve(stateWith(PUZZLE, 1_000), SOLUTION, 61_500);
    expect(solved.solvedAt).toBe(61_500);
    expect(sudokuGame.finished(solved)).toBe(true);
    expect(() => reduce(solved, clear(2), 62_000)).toThrow();
  });

  test("a full grid with a clash is not solved until the clash is fixed", () => {
    const wrong = SOLUTION.slice();
    // Swapping row 0's digits at columns 2 and 6, both open in the puzzle,
    // keeps the row whole but puts a second 9 in column 2 and a second 4 in
    // column 6.
    [wrong[2], wrong[6]] = [wrong[6], wrong[2]];
    const full = solve(stateWith(PUZZLE), wrong, 3_000);
    expect(full.entries.every((digit, cell) => digit !== 0 || PUZZLE[cell] !== 0)).toBe(true);
    expect(full.solvedAt).toBeNull();
    const fixed = reduce(reduce(full, set(2, 4), 4_000), set(6, 9), 5_000);
    expect(fixed.solvedAt).toBe(5_000);
  });

  test("never mutates its input", () => {
    const state = reduce(stateWith(PUZZLE), note(3, 4), 2_000);
    const before = structuredClone(state);
    reduce(state, set(2, 4), 2_000);
    reduce(state, note(2, 4), 2_000);
    reduce(reduce(state, set(2, 4), 2_000), clear(2), 2_000);
    expect(state).toEqual(before);
  });

  test("the same moves on the same day's puzzle play out identically", () => {
    const play = () => {
      const start = init(2026, 1_000);
      const open = start.givens.flatMap((digit, cell) => (digit === 0 ? [cell] : []));
      return open.slice(0, 10).reduce((state, cell, i) => {
        const moved = reduce(state, note(cell, (i % 9) + 1), 2_000 + i);
        return reduce(moved, set(cell, ((i * 4) % 9) + 1), 2_000 + i);
      }, start);
    };
    expect(play()).toEqual(play());
  });
});

describe("view", () => {
  test("is the board and the clock: no PRNG state, no solution", () => {
    const state = init(99, 1_000);
    const v = view(state);
    expect(Object.keys(v).sort()).toEqual(
      ["entries", "givens", "moves", "notes", "solvedAt", "startedAt"].sort(),
    );
    expect(JSON.stringify(v)).not.toContain(`"rng"`);
    expect(JSON.stringify(v)).not.toContain(`"solution"`);
  });
});

describe("score", () => {
  test("a solved run ranks by its time, and says how many moves it took", () => {
    const solved = solve(stateWith(PUZZLE, 1_000), SOLUTION, 185_000);
    expect(score(solved)).toEqual({
      value: 184_000,
      detail: { key: "chart.solved", values: { count: solved.moves } },
    });
    expect(sudokuGame.meta).toMatchObject({ order: "asc", format: "duration" });
  });

  test("an unsolved run is unranked, and says how far it got", () => {
    let state = stateWith(PUZZLE);
    state = reduce(state, { t: "set", cell: 2, digit: 4 }, 2_000);
    state = reduce(state, { t: "note", cell: 3, digit: 6 }, 2_000);
    const open = PUZZLE.filter((digit) => digit === 0).length;
    expect(score(state)).toEqual({
      value: null,
      detail: { key: "chart.unsolved", values: { filled: 1, count: open } },
    });
    expect(sudokuGame.finished(state)).toBe(false);
  });
});

test("the action schema takes a square and a digit, in range, and nothing else", () => {
  expect(SudokuActionSchema.safeParse({ t: "set", cell: 0, digit: 9 }).success).toBe(true);
  expect(SudokuActionSchema.safeParse({ t: "note", cell: 80, digit: 1 }).success).toBe(true);
  expect(SudokuActionSchema.safeParse({ t: "clear", cell: 40 }).success).toBe(true);
  expect(SudokuActionSchema.safeParse({ t: "set", cell: 81, digit: 1 }).success).toBe(false);
  expect(SudokuActionSchema.safeParse({ t: "set", cell: 0, digit: 0 }).success).toBe(false);
  expect(SudokuActionSchema.safeParse({ t: "set", cell: 1.5, digit: 1 }).success).toBe(false);
  expect(SudokuActionSchema.safeParse({ t: "solve" }).success).toBe(false);
});
