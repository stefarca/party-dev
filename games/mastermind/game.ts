import { z } from "zod";

import { shuffle } from "../../shared/prng";
import type { DailyGameModule, DailyScore } from "../../shared/game";
import { clock } from "../common/clock";

// Mastermind, as a daily game. The day's code is five pegs, each a different
// one of seven colours, in order. A player has seven guesses to crack it, and
// every guess is answered with how many of its pegs are the right colour in
// the right place, and how many more are a colour the code holds, but
// elsewhere. A guess holds no colour twice either, since the code never does.
//
// The chart ranks cracked codes by how few guesses they took. A run that ran
// out of guesses, or was ended, is listed after them, unranked.
//
// The code is the one secret here. `view()` never shows it, not even once a
// run is over: it is everyone's code for the day, and a run spent on a single
// guess would hand it to a second nickname. The PRNG is not stored at all,
// since nothing is drawn after the code.

export const COLORS = 7;
export const PEGS = 5;
export const MAX_GUESSES = 7;

// A colour, by its index into the palette the board draws.
const Color = z
  .number()
  .int()
  .min(0)
  .max(COLORS - 1);

export const Code = z
  .array(Color)
  .length(PEGS)
  .refine((pegs) => new Set(pegs).size === pegs.length, "a colour appears twice");

export interface Guess {
  pegs: number[];
  // Pegs of the right colour in the right place.
  exact: number;
  // Pegs of a colour the code holds, in the wrong place.
  near: number;
}

export interface MastermindState {
  // The code. Never shown.
  secret: number[];
  guesses: Guess[];
  startedAt: number;
  solvedAt: number | null;
}

export type MastermindAction = { t: "guess"; pegs: number[] };

export const MastermindActionSchema: z.ZodType<MastermindAction> = z.object({
  t: z.literal("guess"),
  pegs: Code,
});

// Draws the day's code from `seed`, the same for every player: five of the
// seven colours, in an order.
export function deal(seed: number): number[] {
  const [order] = shuffle(
    Array.from({ length: COLORS }, (_, color) => color),
    seed,
  );
  return order.slice(0, PEGS);
}

// How `guess` scores against `secret`. Neither repeats a colour, so every
// colour they share is either in its place or elsewhere, never both.
export function mark(secret: readonly number[], guess: readonly number[]): Guess {
  const exact = guess.filter((color, i) => secret[i] === color).length;
  const shared = guess.filter((color) => secret.includes(color)).length;
  return { pegs: guess.slice(), exact, near: shared - exact };
}

export function isSolved(state: MastermindState): boolean {
  return state.solvedAt !== null;
}

export function isOver(state: MastermindState): boolean {
  return isSolved(state) || state.guesses.length >= MAX_GUESSES;
}

export function init(seed: number, now: number): MastermindState {
  return { secret: deal(seed), guesses: [], startedAt: now, solvedAt: null };
}

// A guess already made is not made again. The page posts moves one after
// another, so a check pressed twice before the first landed would otherwise
// spend a second guess on nothing.
export function reduce(
  state: MastermindState,
  action: MastermindAction,
  now: number,
): MastermindState {
  if (isOver(state)) throw new Error("the run is over");
  const { pegs } = action;
  if (state.guesses.some((guess) => guess.pegs.every((color, i) => pegs[i] === color))) {
    return state;
  }
  const guess = mark(state.secret, pegs);
  return {
    ...state,
    guesses: [...state.guesses, guess],
    solvedAt: guess.exact === PEGS ? now : null,
  };
}

export interface MastermindView {
  guesses: Guess[];
  startedAt: number;
  solvedAt: number | null;
}

export function view(state: MastermindState): MastermindView {
  return {
    guesses: state.guesses.map((guess) => ({ ...guess, pegs: guess.pegs.slice() })),
    startedAt: state.startedAt,
    solvedAt: state.solvedAt,
  };
}

// Cracked codes rank by guesses, and say how long they took. Any other run
// has no guess count to rank, and says how far it got instead.
export function score(state: MastermindState): DailyScore {
  const count = state.guesses.length;
  if (state.solvedAt !== null) {
    return {
      value: count,
      detail: { key: "chart.solved", values: { time: clock(state.solvedAt - state.startedAt) } },
    };
  }
  return {
    value: null,
    detail: { key: count >= MAX_GUESSES ? "chart.failed" : "chart.ended", values: { count } },
  };
}

export const mastermindGame: DailyGameModule<MastermindState, MastermindAction> = {
  id: "mastermind",
  meta: { name: "Mastermind", order: "asc", format: "number" },
  actionSchema: MastermindActionSchema,
  init,
  reduce,
  view,
  finished: isOver,
  score,
};
