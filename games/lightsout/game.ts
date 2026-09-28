import { z } from "zod";

import { nextInt } from "../../shared/prng";
import type { DailyGameModule, DailyScore } from "../../shared/game";
import { clock } from "../common/clock";

// Lights Out, as a daily game. A 5×5 board of lights, some of them on.
// Pressing a light flips it and the lights above, below and beside it; the
// run is won when every light is off. Pressing a light twice undoes it, so
// the order of presses never matters, only which lights were pressed an odd
// number of times.
//
// The chart ranks solved boards by how few presses they took. The day's par,
// the fewest presses that can solve its board, is shown from the start as
// the number to aim for. A run ended with lights still on is listed after
// the solved ones, unranked.
//
// Nothing here is secret: the whole board is on the screen from the first
// move, and so is par. The PRNG is not stored at all, since nothing is drawn
// after the deal.

export const SIZE = 5;
export const CELLS = SIZE * SIZE;

export const rowOf = (cell: number) => Math.floor(cell / SIZE);
export const colOf = (cell: number) => cell % SIZE;

// The lights each press flips, one bit per cell: the pressed light and the
// ones sharing a side with it, never diagonally.
export const FLIPS: readonly number[] = Array.from({ length: CELLS }, (_, cell) => {
  let bits = 1 << cell;
  if (rowOf(cell) > 0) bits |= 1 << (cell - SIZE);
  if (rowOf(cell) < SIZE - 1) bits |= 1 << (cell + SIZE);
  if (colOf(cell) > 0) bits |= 1 << (cell - 1);
  if (colOf(cell) < SIZE - 1) bits |= 1 << (cell + 1);
  return bits;
});

// The board with `cell` pressed.
export function press(lights: readonly boolean[], cell: number): boolean[] {
  return lights.map((on, other) => ((FLIPS[cell] >> other) & 1 ? !on : on));
}

export function litCount(lights: readonly boolean[]): number {
  return lights.filter(Boolean).length;
}

function popcount(bits: number): number {
  let count = 0;
  for (let rest = bits; rest !== 0; rest &= rest - 1) count++;
  return count;
}

// The bit above every cell's: in an equation below, whether its light is on.
const ON = 1 << CELLS;

// The fewest lights to press to turn every light on `lights` off, in cell
// order, or null when no presses can.
//
// Each light is one equation over GF(2): the presses that flip it must add
// up to whether it is on. A press flips exactly the lights that would flip
// it, so a light's equation names the same cells as `FLIPS` does. Gaussian
// elimination leaves one press per equation settled by the free ones, and on
// a 5×5 board two presses stay free: every solvable board has four
// solutions, and trying each finds the shortest.
export function solve(lights: readonly boolean[]): number[] | null {
  const rows = lights.map((on, cell) => FLIPS[cell] | (on ? ON : 0));
  // The press each reduced row settles, by row.
  const pivots: number[] = [];
  for (let col = 0; col < CELLS; col++) {
    const bit = 1 << col;
    const top = pivots.length;
    const found = rows.findIndex((row, i) => i >= top && (row & bit) !== 0);
    if (found < 0) continue;
    [rows[top], rows[found]] = [rows[found], rows[top]];
    for (let i = 0; i < CELLS; i++) {
      if (i !== top && (rows[i] & bit) !== 0) rows[i] ^= rows[top];
    }
    pivots.push(col);
  }
  // A row left over names no press, so it can only still ask for a light on.
  if (rows.slice(pivots.length).some((row) => row !== 0)) return null;

  const free = Array.from({ length: CELLS }, (_, cell) => cell).filter(
    (cell) => !pivots.includes(cell),
  );
  let best = -1;
  for (let pick = 0; pick < 1 << free.length; pick++) {
    let presses = 0;
    free.forEach((cell, k) => {
      if ((pick >> k) & 1) presses |= 1 << cell;
    });
    // A reduced row names its own press and free ones only, so the free
    // presses picked settle it.
    pivots.forEach((cell, r) => {
      const flipped = popcount(rows[r] & presses) & 1;
      const on = rows[r] & ON ? 1 : 0;
      if (flipped !== on) presses |= 1 << cell;
    });
    if (best < 0 || popcount(presses) < popcount(best)) best = presses;
  }
  return Array.from({ length: CELLS }, (_, cell) => cell).filter((cell) => (best >> cell) & 1);
}

// The fewest presses the day's board may take. A board solved in three
// presses is no day's puzzle.
export const MIN_PAR = 8;

// How many boards `deal()` draws before settling for one under `MIN_PAR`.
// Most boards clear it, so a seed finds one within a few; the cap only bounds
// the work on a seed that never would.
const MAX_DEALS = 50;

export interface Deal {
  // Row-major: cell = row * SIZE + col.
  lights: boolean[];
  par: number;
}

// Draws the day's board from `seed`, the same for every player: a dark board
// with a coin tossed for every light, pressed where it lands heads. A board
// made by pressing can always be pressed back, so every deal has a solution.
// Drawn again until its par is at least `MIN_PAR`.
export function deal(seed: number): Deal {
  let rng = seed;
  let last: Deal | null = null;
  for (let attempt = 0; attempt < MAX_DEALS; attempt++) {
    let lights = new Array<boolean>(CELLS).fill(false);
    for (let cell = 0; cell < CELLS; cell++) {
      const [heads, next] = nextInt(rng, 2);
      rng = next;
      if (heads === 1) lights = press(lights, cell);
    }
    last = { lights, par: (solve(lights) as number[]).length };
    if (last.par >= MIN_PAR) return last;
  }
  return last as Deal;
}

export interface LightsOutState {
  lights: boolean[];
  // The fewest presses that solve the day's board.
  par: number;
  presses: number;
  startedAt: number;
  solvedAt: number | null;
}

export type LightsOutAction = { t: "press"; cell: number };

export const LightsOutActionSchema: z.ZodType<LightsOutAction> = z.object({
  t: z.literal("press"),
  cell: z
    .number()
    .int()
    .min(0)
    .max(CELLS - 1),
});

export function isSolved(state: LightsOutState): boolean {
  return state.solvedAt !== null;
}

export function init(seed: number, now: number): LightsOutState {
  const { lights, par } = deal(seed);
  return { lights, par, presses: 0, startedAt: now, solvedAt: null };
}

// Every press flips something, so none is a no-op. Two taps on one light
// sent before the first landed are two presses, and undo each other, which
// is what the player did.
export function reduce(
  state: LightsOutState,
  action: LightsOutAction,
  now: number,
): LightsOutState {
  if (isSolved(state)) throw new Error("the run is over");
  const lights = press(state.lights, action.cell);
  return {
    ...state,
    lights,
    presses: state.presses + 1,
    solvedAt: litCount(lights) === 0 ? now : null,
  };
}

export interface LightsOutView {
  lights: boolean[];
  par: number;
  presses: number;
  startedAt: number;
  solvedAt: number | null;
}

export function view(state: LightsOutState): LightsOutView {
  return {
    lights: state.lights.slice(),
    par: state.par,
    presses: state.presses,
    startedAt: state.startedAt,
    solvedAt: state.solvedAt,
  };
}

// Solved boards rank by presses, and say how long they took. Any other run
// has no press count to rank, and says how many lights it left on instead.
export function score(state: LightsOutState): DailyScore {
  if (state.solvedAt !== null) {
    return {
      value: state.presses,
      detail: {
        key: state.presses === state.par ? "chart.par" : "chart.solved",
        values: { time: clock(state.solvedAt - state.startedAt) },
      },
    };
  }
  return { value: null, detail: { key: "chart.ended", values: { count: litCount(state.lights) } } };
}

export const lightsOutGame: DailyGameModule<LightsOutState, LightsOutAction> = {
  id: "lightsout",
  meta: { name: "Lights Out", order: "asc", format: "number" },
  actionSchema: LightsOutActionSchema,
  init,
  reduce,
  view,
  finished: isSolved,
  score,
};

// The light `dRow` rows and `dCol` columns from `cell`, stopping at the
// edge: where an arrow key moves the board's selection.
export function step(cell: number, dRow: number, dCol: number): number {
  const row = Math.min(SIZE - 1, Math.max(0, rowOf(cell) + dRow));
  const col = Math.min(SIZE - 1, Math.max(0, colOf(cell) + dCol));
  return row * SIZE + col;
}
