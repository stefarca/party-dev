import { z } from "zod";

import { nextInt, shuffle } from "../../shared/prng";
import type { DailyGameModule, DailyScore } from "../../shared/game";

// Minesweeper, as a daily game. Open every square that hides no mine; each
// open square says how many of the eight around it do. Setting one off ends
// the run. The chart ranks cleared boards by time, fastest first; a run that
// ends any other way is listed after them, unranked.
//
// Every player gets the same minefield and the same opening, already cleared
// when the run starts. A board ranked by time has to be one that skill can
// clear, so the deal is drawn again and again until one can be cleared from
// that opening by deduction alone (see `solvable()`): a player never has to
// guess, and a mine set off is a mistake, never bad luck.
//
// The mines are the one secret here. `view()` shows a square only once it is
// open, and not even a lost run shows the rest of the field: it is everyone's
// board for the day, and a run spent on a single click would hand it to a
// second nickname. The PRNG is not stored at all, since nothing is drawn after
// the deal.

export const COLS = 10;
export const ROWS = 12;
export const CELLS = COLS * ROWS;
export const MINES = 20;
// The squares a player has to open to clear the board.
export const SAFE = CELLS - MINES;

export const rowOf = (cell: number) => Math.floor(cell / COLS);
export const colOf = (cell: number) => cell % COLS;

// The squares touching each square: eight, or fewer along the edges.
export const NEIGHBOURS: readonly (readonly number[])[] = Array.from(
  { length: CELLS },
  (_, cell) => {
    const around: number[] = [];
    for (let dRow = -1; dRow <= 1; dRow++) {
      for (let dCol = -1; dCol <= 1; dCol++) {
        const row = rowOf(cell) + dRow;
        const col = colOf(cell) + dCol;
        if ((dRow !== 0 || dCol !== 0) && row >= 0 && row < ROWS && col >= 0 && col < COLS) {
          around.push(row * COLS + col);
        }
      }
    }
    return around;
  },
);

// How many mines touch each square.
export function countsOf(mines: readonly boolean[]): number[] {
  return NEIGHBOURS.map((around) => around.filter((other) => mines[other]).length);
}

// Opens `cells` in `revealed`, and with every square that touches no mine,
// the squares around it too, the way a click on one opens a whole clearing.
// Returns the squares it opened.
function flood(counts: readonly number[], revealed: boolean[], cells: readonly number[]): number[] {
  const opened: number[] = [];
  const stack = cells.slice();
  while (stack.length > 0) {
    const cell = stack.pop() as number;
    if (revealed[cell]) continue;
    revealed[cell] = true;
    opened.push(cell);
    if (counts[cell] === 0) {
      for (const other of NEIGHBOURS[cell]) if (!revealed[other]) stack.push(other);
    }
  }
  return opened;
}

// What the solver below knows of a square.
const HIDDEN = 0;
const OPEN = 1;
const MINE = 2;

// Whether a player who starts from `start`'s clearing can open every safe
// square of `mines` without ever guessing. It plays the board with the
// deductions a player makes, and nothing cleverer:
//
//  - A number whose mines are all found has only safe squares left around
//    it; one with as many hidden squares left as mines, only mines.
//  - Two numbers that share hidden squares bound how many mines those shared
//    squares hold, and so what the rest of each one's squares must be (the
//    "1-2" patterns).
//  - Once every mine is found, whatever is still hidden is safe: the player
//    knows how many mines the board holds.
//
// Every one of these is forced, so a board this clears has one way through
// from the opening, and every player gets that same opening.
export function solvable(mines: readonly boolean[], start: number): boolean {
  const counts = countsOf(mines);
  const total = mines.filter(Boolean).length;
  const known = new Array<number>(CELLS).fill(HIDDEN);
  let opened = 0;
  let found = 0;

  const reveal = (cell: number): void => {
    const stack = [cell];
    while (stack.length > 0) {
      const next = stack.pop() as number;
      if (known[next] !== HIDDEN) continue;
      known[next] = OPEN;
      opened++;
      if (counts[next] === 0) {
        for (const other of NEIGHBOURS[next]) if (known[other] === HIDDEN) stack.push(other);
      }
    }
  };
  const mark = (cell: number): void => {
    if (known[cell] !== HIDDEN) return;
    known[cell] = MINE;
    found++;
  };

  reveal(start);
  while (opened < CELLS - total) {
    // Each open number with hidden squares around it: `need` of `cells` are
    // mines.
    const constraints: { cells: number[]; need: number }[] = [];
    let progress = false;
    for (let cell = 0; cell < CELLS; cell++) {
      if (known[cell] !== OPEN || counts[cell] === 0) continue;
      const cells: number[] = [];
      let need = counts[cell];
      for (const other of NEIGHBOURS[cell]) {
        if (known[other] === MINE) need--;
        else if (known[other] === HIDDEN) cells.push(other);
      }
      if (cells.length === 0) continue;
      if (need === 0) {
        for (const other of cells) reveal(other);
        progress = true;
      } else if (need === cells.length) {
        for (const other of cells) mark(other);
        progress = true;
      } else {
        constraints.push({ cells, need });
      }
    }
    if (progress) continue;

    // Which constraints each hidden square is in, so that only numbers
    // sharing a square are ever compared.
    const bySquare = new Map<number, number[]>();
    constraints.forEach(({ cells }, index) => {
      for (const cell of cells) {
        const list = bySquare.get(cell);
        if (list) list.push(index);
        else bySquare.set(cell, [index]);
      }
    });
    constraints.forEach((a, index) => {
      const partners = new Set<number>();
      for (const cell of a.cells) for (const other of bySquare.get(cell) ?? []) partners.add(other);
      partners.delete(index);
      for (const other of partners) {
        const b = constraints[other];
        const shared = b.cells.filter((cell) => a.cells.includes(cell)).length;
        const onlyB = b.cells.filter((cell) => !a.cells.includes(cell));
        if (onlyB.length === 0) continue;
        // The fewest and the most mines the shared squares can hold.
        const least = Math.max(0, a.need - (a.cells.length - shared), b.need - onlyB.length);
        const most = Math.min(shared, a.need, b.need);
        if (b.need - least === 0) {
          for (const cell of onlyB) reveal(cell);
          progress = true;
        } else if (b.need - most === onlyB.length) {
          for (const cell of onlyB) mark(cell);
          progress = true;
        }
      }
    });
    if (progress) continue;

    if (found < total) return false;
    for (let cell = 0; cell < CELLS; cell++) reveal(cell);
  }
  return true;
}

// How many deals `deal()` tries before settling for one that needs a guess.
// About half of all deals can be cleared, so a seed finds one within a
// handful; the cap only bounds the work on a seed that never would.
const MAX_DEALS = 100;

// The most safe squares the opening may clear. A start in a wide clearing can
// open most of the board, and a day spent on the last few squares is no day's
// puzzle at all.
export const MAX_OPENING = SAFE / 2;

export interface Deal {
  // Row-major: cell = row * COLS + col.
  mines: boolean[];
  // The square the run starts from, opened for the player. No mine touches
  // it, so it opens a clearing.
  start: number;
}

// Draws the day's minefield from `seed`, the same for every player: a start
// square, then the mines, anywhere but on or around it. Drawn again until the
// opening leaves most of the board to play and the rest can be cleared
// without guessing.
export function deal(seed: number): Deal {
  let rng = seed;
  let last: Deal | null = null;
  for (let attempt = 0; attempt < MAX_DEALS; attempt++) {
    const [start, afterStart] = nextInt(rng, CELLS);
    const clear = new Set([start, ...NEIGHBOURS[start]]);
    const spots = Array.from({ length: CELLS }, (_, cell) => cell).filter(
      (cell) => !clear.has(cell),
    );
    const [order, next] = shuffle(spots, afterStart);
    rng = next;
    const mines = new Array<boolean>(CELLS).fill(false);
    for (const cell of order.slice(0, MINES)) mines[cell] = true;
    last = { mines, start };
    const opening = flood(countsOf(mines), new Array<boolean>(CELLS).fill(false), [start]);
    if (opening.length <= MAX_OPENING && solvable(mines, start)) return last;
  }
  return last as Deal;
}

export interface MinesweeperState {
  // The minefield, row-major. Never shown until the square is open.
  mines: boolean[];
  revealed: boolean[];
  flagged: boolean[];
  // Clicks and chords that opened something. Flags are not moves.
  moves: number;
  startedAt: number;
  clearedAt: number | null;
  // The mine that went off, and when. It ends the run.
  blast: { cell: number; at: number } | null;
}

export type MinesweeperAction =
  // Opens a hidden square. A flagged one stays shut.
  | { t: "reveal"; cell: number }
  // On an open number with as many flags around it as mines, opens every
  // other hidden square around it.
  | { t: "chord"; cell: number }
  // Plants a flag on a hidden square, or pulls it up. Says which, rather
  // than toggling, so a tap sent twice before the first lands does not undo
  // itself.
  | { t: "flag"; cell: number; on: boolean };

const Cell = z
  .number()
  .int()
  .min(0)
  .max(CELLS - 1);

export const MinesweeperActionSchema: z.ZodType<MinesweeperAction> = z.discriminatedUnion("t", [
  z.object({ t: z.literal("reveal"), cell: Cell }),
  z.object({ t: z.literal("chord"), cell: Cell }),
  z.object({ t: z.literal("flag"), cell: Cell, on: z.boolean() }),
]);

export function isOver(state: MinesweeperState): boolean {
  return state.clearedAt !== null || state.blast !== null;
}

export function init(seed: number, now: number): MinesweeperState {
  const { mines, start } = deal(seed);
  const revealed = new Array<boolean>(CELLS).fill(false);
  flood(countsOf(mines), revealed, [start]);
  return {
    mines,
    revealed,
    flagged: new Array<boolean>(CELLS).fill(false),
    moves: 0,
    startedAt: now,
    clearedAt: null,
    blast: null,
  };
}

// Opens `cells` as one move. Any of them a mine ends the run there. A flag in
// the clearing a move opens was wrong, since no square around a 0 is a mine,
// so the clearing opens it and takes the flag away.
function open(state: MinesweeperState, cells: readonly number[], now: number): MinesweeperState {
  const moves = state.moves + 1;
  const mine = cells.find((cell) => state.mines[cell]);
  if (mine !== undefined) return { ...state, moves, blast: { cell: mine, at: now } };

  const revealed = state.revealed.slice();
  const opened = flood(countsOf(state.mines), revealed, cells);
  let flagged = state.flagged;
  if (opened.some((cell) => flagged[cell])) {
    flagged = flagged.slice();
    for (const cell of opened) flagged[cell] = false;
  }
  const cleared = revealed.every((open, cell) => open || state.mines[cell]);
  return { ...state, revealed, flagged, moves, clearedAt: cleared ? now : null };
}

// A move that changes nothing — opening an open square or a flagged one, a
// chord whose flags do not add up, a flag already there — is not an error.
// The page posts moves made against a board that has not yet caught up with
// the ones before them, and one of those must never fail the rest.
export function reduce(
  state: MinesweeperState,
  action: MinesweeperAction,
  now: number,
): MinesweeperState {
  if (isOver(state)) throw new Error("the run is over");
  const { cell } = action;

  switch (action.t) {
    case "reveal": {
      if (state.revealed[cell] || state.flagged[cell]) return state;
      return open(state, [cell], now);
    }
    case "chord": {
      if (!state.revealed[cell]) return state;
      const around = NEIGHBOURS[cell];
      const need = around.filter((other) => state.mines[other]).length;
      const flags = around.filter((other) => state.flagged[other]).length;
      const targets = around.filter((other) => !state.revealed[other] && !state.flagged[other]);
      if (need === 0 || flags !== need || targets.length === 0) return state;
      return open(state, targets, now);
    }
    case "flag": {
      if (state.revealed[cell] || state.flagged[cell] === action.on) return state;
      const flagged = state.flagged.slice();
      flagged[cell] = action.on;
      return { ...state, flagged };
    }
  }
}

// A square as the player sees it: the number of an open one, a hidden one,
// a flag, or the mine that went off. Once the board is cleared, every square
// still hidden is a mine the player has found, so each shows as a flag.
export type Square = number | "hidden" | "flag" | "mine";

export interface MinesweeperView {
  squares: Square[];
  moves: number;
  startedAt: number;
  clearedAt: number | null;
  blast: { cell: number; at: number } | null;
}

export function view(state: MinesweeperState): MinesweeperView {
  const counts = countsOf(state.mines);
  const cleared = state.clearedAt !== null;
  return {
    squares: counts.map((count, cell): Square => {
      if (state.revealed[cell]) return count;
      if (state.blast?.cell === cell) return "mine";
      return state.flagged[cell] || cleared ? "flag" : "hidden";
    }),
    moves: state.moves,
    startedAt: state.startedAt,
    clearedAt: state.clearedAt,
    blast: state.blast,
  };
}

// Cleared runs rank by time. Any other has no time to rank, and says how far
// it got instead.
export function score(state: MinesweeperState): DailyScore {
  if (state.clearedAt !== null) {
    return {
      value: state.clearedAt - state.startedAt,
      detail: { key: "chart.cleared", values: { count: state.moves } },
    };
  }
  const cleared = state.revealed.filter(Boolean).length;
  const count = state.mines.filter((mine) => !mine).length;
  return {
    value: null,
    detail: { key: state.blast ? "chart.blast" : "chart.unfinished", values: { cleared, count } },
  };
}

export const minesweeperGame: DailyGameModule<MinesweeperState, MinesweeperAction> = {
  id: "minesweeper",
  meta: { name: "Minesweeper", order: "asc", format: "duration" },
  actionSchema: MinesweeperActionSchema,
  init,
  reduce,
  view,
  finished: isOver,
  score,
};

// The square `dRow` rows and `dCol` columns from `cell`, stopping at the
// edge: where an arrow key moves the board's selection.
export function step(cell: number, dRow: number, dCol: number): number {
  const row = Math.min(ROWS - 1, Math.max(0, rowOf(cell) + dRow));
  const col = Math.min(COLS - 1, Math.max(0, colOf(cell) + dCol));
  return row * COLS + col;
}
