import { z } from "zod";

import { shuffle } from "../../shared/prng";
import type { DailyGameModule, DailyScore } from "../../shared/game";

// Sudoku, as a daily game. Fill the 9×9 grid so that every row, every column
// and every 3×3 box holds each digit from 1 to 9 exactly once. The chart ranks
// solved runs by time, fastest first; a run that ends unsolved is listed
// after them, unranked.
//
// Every player gets the same puzzle: the day's seed fills a grid, then empties
// its cells in pairs mirrored through the centre for as long as the puzzle can
// still be solved by singles alone — a square with one digit left, or a digit
// with one square left in a row, column or box. That keeps it fair and
// human-sized, and it also proves the solution unique, since every step of
// singles is forced.
//
// The solution is never stored. A full grid in which no digit clashes with
// another is a solution, and a puzzle with only one solution has no other, so
// the rules can check a finished grid by themselves. The PRNG is not stored
// either: nothing is drawn after the deal.

export const SIZE = 9;
export const BOX = 3;
export const CELLS = SIZE * SIZE;

// Every digit 1–9 as a bit, digit d at bit d - 1.
const ALL = (1 << SIZE) - 1;

export const rowOf = (cell: number) => Math.floor(cell / SIZE);
export const colOf = (cell: number) => cell % SIZE;
export const boxOf = (cell: number) =>
  Math.floor(rowOf(cell) / BOX) * BOX + Math.floor(colOf(cell) / BOX);

// The 27 units, each a list of 9 cells: the rows, then the columns, then the
// boxes.
export const UNITS: readonly (readonly number[])[] = [
  ...Array.from({ length: SIZE }, (_, row) =>
    Array.from({ length: SIZE }, (_, col) => row * SIZE + col),
  ),
  ...Array.from({ length: SIZE }, (_, col) =>
    Array.from({ length: SIZE }, (_, row) => row * SIZE + col),
  ),
  ...Array.from({ length: SIZE }, (_, box) =>
    Array.from({ length: SIZE }, (_, i) => {
      const row = Math.floor(box / BOX) * BOX + Math.floor(i / BOX);
      const col = (box % BOX) * BOX + (i % BOX);
      return row * SIZE + col;
    }),
  ),
];

// The 20 other cells that share a row, column or box with each cell.
export const PEERS: readonly (readonly number[])[] = Array.from({ length: CELLS }, (_, cell) =>
  Array.from({ length: CELLS }, (_, other) => other).filter(
    (other) =>
      other !== cell &&
      (rowOf(other) === rowOf(cell) ||
        colOf(other) === colOf(cell) ||
        boxOf(other) === boxOf(cell)),
  ),
);

const bitOf = (digit: number) => 1 << (digit - 1);

function digitOf(bit: number): number {
  return 31 - Math.clz32(bit) + 1;
}

// The digits in `mask`, smallest first.
export function digitsIn(mask: number): number[] {
  const digits: number[] = [];
  for (let digit = 1; digit <= SIZE; digit++) if (mask & bitOf(digit)) digits.push(digit);
  return digits;
}

// Which digits each row, column and box already holds, for a grid being
// filled or solved. Placing a digit keeps them in step.
class Marks {
  rows = new Array<number>(SIZE).fill(0);
  cols = new Array<number>(SIZE).fill(0);
  boxes = new Array<number>(SIZE).fill(0);

  // The digits `cell` could still take.
  candidates(cell: number): number {
    return ALL & ~(this.rows[rowOf(cell)] | this.cols[colOf(cell)] | this.boxes[boxOf(cell)]);
  }

  toggle(cell: number, digit: number): void {
    const bit = bitOf(digit);
    this.rows[rowOf(cell)] ^= bit;
    this.cols[colOf(cell)] ^= bit;
    this.boxes[boxOf(cell)] ^= bit;
  }
}

// A full, valid grid drawn from `rng`: each empty cell is filled in turn —
// always the one with the fewest digits left — trying its digits in a
// shuffled order, and backing up out of a dead end.
export function fillGrid(rng: number): [grid: number[], rng: number] {
  const grid = new Array<number>(CELLS).fill(0);
  const marks = new Marks();
  let state = rng;

  const fill = (): boolean => {
    let best = -1;
    let bestCandidates = 0;
    let fewest = SIZE + 1;
    for (let cell = 0; cell < CELLS; cell++) {
      if (grid[cell] !== 0) continue;
      const candidates = marks.candidates(cell);
      const count = digitsIn(candidates).length;
      if (count < fewest) {
        best = cell;
        bestCandidates = candidates;
        fewest = count;
        if (count <= 1) break;
      }
    }
    if (best === -1) return true;
    if (fewest === 0) return false;
    const [order, next] = shuffle(digitsIn(bestCandidates), state);
    state = next;
    for (const digit of order) {
      grid[best] = digit;
      marks.toggle(best, digit);
      if (fill()) return true;
      marks.toggle(best, digit);
      grid[best] = 0;
    }
    return false;
  };

  fill();
  return [grid, state];
}

// Solves `puzzle` (0 for an empty cell) with singles alone, or returns null
// where they run out. A naked single is a square with one digit left; a hidden
// single, a digit with one square left in some row, column or box. Both are
// forced, so a grid this solves has no other solution.
export function solveBySingles(puzzle: readonly number[]): number[] | null {
  const grid = puzzle.slice();
  const marks = new Marks();
  let open = 0;
  for (let cell = 0; cell < CELLS; cell++) {
    const digit = grid[cell];
    if (digit === 0) open++;
    else if (!(marks.candidates(cell) & bitOf(digit))) return null;
    else marks.toggle(cell, digit);
  }

  // Places `digit` if the square can still take it: an earlier placement in
  // the same pass may have used it up.
  const place = (cell: number, digit: number): boolean => {
    if (grid[cell] !== 0 || !(marks.candidates(cell) & bitOf(digit))) return false;
    grid[cell] = digit;
    marks.toggle(cell, digit);
    open--;
    return true;
  };

  while (open > 0) {
    let progress = false;
    for (let cell = 0; cell < CELLS; cell++) {
      if (grid[cell] !== 0) continue;
      const candidates = marks.candidates(cell);
      if (candidates === 0) return null;
      if ((candidates & (candidates - 1)) === 0 && place(cell, digitOf(candidates))) {
        progress = true;
      }
    }
    for (const unit of UNITS) {
      let placed = 0;
      let once = 0;
      let twice = 0;
      for (const cell of unit) {
        if (grid[cell] !== 0) {
          placed |= bitOf(grid[cell]);
          continue;
        }
        const candidates = marks.candidates(cell);
        twice |= once & candidates;
        once |= candidates;
      }
      // A digit this unit still needs but can put nowhere.
      if ((placed | once) !== ALL) return null;
      let hidden = once & ~twice & ~placed;
      while (hidden !== 0) {
        const bit = hidden & -hidden;
        hidden ^= bit;
        const cell = unit.find((c) => grid[c] === 0 && marks.candidates(c) & bit);
        if (cell !== undefined && place(cell, digitOf(bit))) progress = true;
      }
    }
    if (!progress) return null;
  }
  return grid;
}

// Empties `solution`'s cells in pairs mirrored through the centre, in an
// order drawn from `rng`, keeping each pair out only while the puzzle is
// still solvable by singles.
export function dig(solution: readonly number[], rng: number): [puzzle: number[], rng: number] {
  const puzzle = solution.slice();
  const half = Array.from({ length: Math.ceil(CELLS / 2) }, (_, cell) => cell);
  const [order, next] = shuffle(half, rng);
  for (const cell of order) {
    const mirror = CELLS - 1 - cell;
    const kept = [puzzle[cell], puzzle[mirror]];
    puzzle[cell] = 0;
    puzzle[mirror] = 0;
    if (!solveBySingles(puzzle)) {
      puzzle[cell] = kept[0];
      puzzle[mirror] = kept[1];
    }
  }
  return [puzzle, next];
}

// The cells whose digit another cell in one of its units also holds. Both
// cells of a clash are marked, a given one included.
export function clashes(values: readonly number[]): boolean[] {
  const clash = new Array<boolean>(CELLS).fill(false);
  for (const unit of UNITS) {
    for (const cell of unit) {
      const digit = values[cell];
      if (digit === 0) continue;
      if (unit.some((other) => other !== cell && values[other] === digit)) clash[cell] = true;
    }
  }
  return clash;
}

// The grid as a player sees it: each given, or else the digit entered there.
export function valuesOf(board: { givens: readonly number[]; entries: readonly number[] }) {
  return board.givens.map((given, cell) => given || board.entries[cell]);
}

// Solved: every square filled, and no digit twice in any unit.
export function isSolved(values: readonly number[]): boolean {
  return values.every((digit) => digit !== 0) && !clashes(values).some(Boolean);
}

export interface SudokuState {
  // The puzzle, 0 for a square the player fills. Row-major: cell = row * 9 + col.
  givens: number[];
  // What the player has entered, 0 for nothing (and always 0 on a given).
  entries: number[];
  // The digits pencilled into each square, as bits: digit d at bit d - 1.
  notes: number[];
  // Digits entered, changed or erased.
  moves: number;
  startedAt: number;
  solvedAt: number | null;
}

export type SudokuAction =
  // Enters `digit`, replacing whatever the square held.
  | { t: "set"; cell: number; digit: number }
  // Erases the square's digit, or, when it has none, its notes.
  | { t: "clear"; cell: number }
  // Pencils `digit` into an empty square, or rubs it out again.
  | { t: "note"; cell: number; digit: number };

const Cell = z
  .number()
  .int()
  .min(0)
  .max(CELLS - 1);
const Digit = z.number().int().min(1).max(SIZE);

export const SudokuActionSchema: z.ZodType<SudokuAction> = z.discriminatedUnion("t", [
  z.object({ t: z.literal("set"), cell: Cell, digit: Digit }),
  z.object({ t: z.literal("clear"), cell: Cell }),
  z.object({ t: z.literal("note"), cell: Cell, digit: Digit }),
]);

// Deals the day's puzzle from `seed`, the same for every player.
export function deal(seed: number): number[] {
  const [solution, afterFill] = fillGrid(seed);
  return dig(solution, afterFill)[0];
}

export function init(seed: number, now: number): SudokuState {
  return {
    givens: deal(seed),
    entries: new Array<number>(CELLS).fill(0),
    notes: new Array<number>(CELLS).fill(0),
    moves: 0,
    startedAt: now,
    solvedAt: null,
  };
}

// A move that changes nothing — entering the digit a square already holds,
// erasing an empty one, a note on a filled one — is not an error. The page
// posts moves made against a board that has not yet caught up with the ones
// before them, and one of those must never fail the rest.
//
// A given is another matter: the board never offers one, so an action on it
// is refused.
export function reduce(state: SudokuState, action: SudokuAction, now: number): SudokuState {
  if (state.solvedAt !== null) throw new Error("the puzzle is already solved");
  const { cell } = action;
  if (state.givens[cell] !== 0) throw new Error("that square is part of the puzzle");

  switch (action.t) {
    case "set": {
      if (state.entries[cell] === action.digit) return state;
      const entries = state.entries.slice();
      entries[cell] = action.digit;
      // The square's own notes go, and so does this digit from every note
      // that shares a unit with it: it can no longer go there.
      const notes = state.notes.slice();
      notes[cell] = 0;
      for (const peer of PEERS[cell]) notes[peer] &= ~bitOf(action.digit);
      const solved = isSolved(valuesOf({ givens: state.givens, entries }));
      return { ...state, entries, notes, moves: state.moves + 1, solvedAt: solved ? now : null };
    }
    case "clear": {
      if (state.entries[cell] !== 0) {
        const entries = state.entries.slice();
        entries[cell] = 0;
        return { ...state, entries, moves: state.moves + 1 };
      }
      if (state.notes[cell] === 0) return state;
      const notes = state.notes.slice();
      notes[cell] = 0;
      return { ...state, notes };
    }
    case "note": {
      if (state.entries[cell] !== 0) return state;
      const notes = state.notes.slice();
      notes[cell] ^= bitOf(action.digit);
      return { ...state, notes };
    }
  }
}

export interface SudokuView {
  givens: number[];
  entries: number[];
  notes: number[];
  moves: number;
  startedAt: number;
  solvedAt: number | null;
}

// Everything in the state is the player's to see: there is no PRNG state and
// no solution in it.
export function view(state: SudokuState): SudokuView {
  return {
    givens: state.givens,
    entries: state.entries,
    notes: state.notes,
    moves: state.moves,
    startedAt: state.startedAt,
    solvedAt: state.solvedAt,
  };
}

// Solved runs rank by time. One that ended unsolved has no time to rank, and
// says how far it got instead.
export function score(state: SudokuState): DailyScore {
  if (state.solvedAt !== null) {
    return {
      value: state.solvedAt - state.startedAt,
      detail: { key: "chart.solved", values: { count: state.moves } },
    };
  }
  const open = state.givens.filter((given) => given === 0).length;
  const filled = state.entries.filter((digit) => digit !== 0).length;
  return { value: null, detail: { key: "chart.unsolved", values: { filled, count: open } } };
}

export const sudokuGame: DailyGameModule<SudokuState, SudokuAction> = {
  id: "sudoku",
  meta: { name: "Sudoku", order: "asc", format: "duration" },
  actionSchema: SudokuActionSchema,
  init,
  reduce,
  view,
  finished: (state) => state.solvedAt !== null,
  score,
};

// The cell `dRow` rows and `dCol` columns from `cell`, stopping at the edge:
// where an arrow key moves the board's selection.
export function step(cell: number, dRow: number, dCol: number): number {
  const row = Math.min(SIZE - 1, Math.max(0, rowOf(cell) + dRow));
  const col = Math.min(SIZE - 1, Math.max(0, colOf(cell) + dCol));
  return row * SIZE + col;
}
