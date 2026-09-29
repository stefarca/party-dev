import { z } from "zod";

import { nextInt } from "../../shared/prng";
import type { DailyGameModule, DailyScore } from "../../shared/game";

// Yahtzee, as a daily game: the classic solitaire card of thirteen boxes. A
// round is up to three rolls of five dice, holding any of them between
// rolls, and ends by scoring the dice in a box not yet filled, for whatever
// that box makes of them, zero included. Thirteen rounds fill the card, and
// the chart ranks runs by its total.
//
// The dice are the day's, drawn up front: every round, every roll of it and
// every die in its place has a face waiting, the same for every player. A die
// thrown on the second roll of round four lands on that face whoever throws
// it, so every round opens with the same five dice for everyone, and what
// sets runs apart is which dice were held and where they were scored.
//
// The faces not yet thrown are the one secret here. `view()` never shows
// them, not even once a run is over: they are everyone's for the day, and a
// run spent rolling everything would hand them to a second nickname. Nothing
// is drawn after the deal, so no PRNG is stored.
//
// The official rules, bonuses and jokers included:
// - The upper boxes score the dice showing their number. An upper total of
//   `UPPER_BONUS_AT` or more earns `UPPER_BONUS`.
// - A Yahtzee (five of a kind) scores 50 in its own box. Every further one
//   rolled while that box holds 50 earns a bonus of 100, and while the box
//   is filled at all, a Yahtzee is a joker: it must go in the upper box of
//   its number if that is open; failing that, in any open lower box, where
//   a full house or a straight scores in full; failing that, as a zero in
//   any open upper box.

export const DICE = 5;
export const FACES = 6;
export const ROLLS = 3;
export const UPPER_BONUS_AT = 63;
export const UPPER_BONUS = 35;
export const YAHTZEE_BONUS = 100;

export const UPPER = ["ones", "twos", "threes", "fours", "fives", "sixes"] as const;
export const LOWER = [
  "threeKind",
  "fourKind",
  "fullHouse",
  "smallStraight",
  "largeStraight",
  "yahtzee",
  "chance",
] as const;
export const CATEGORIES = [...UPPER, ...LOWER] as const;
export type Category = (typeof CATEGORIES)[number];

// One round per box.
export const ROUNDS = CATEGORIES.length;

const FULL_HOUSE = 25;
const SMALL_STRAIGHT = 30;
const LARGE_STRAIGHT = 40;
const FIFTY = 50;

// The boxes filled so far, each with what it scored.
export type Card = Partial<Record<Category, number>>;

// A face, 1 to 6, for every round, every roll of it, and every die in its
// place: `faces[round][roll][die]`.
export type Faces = number[][][];

// The box a round was scored in, for the board to mark and announce.
export interface Scored {
  category: Category;
  points: number;
  // Whether it came with a Yahtzee bonus.
  bonus: boolean;
}

export interface YahtzeeState {
  // The day's dice. Never shown.
  faces: Faces;
  // The round being played, from 0; `ROUNDS` once the card is full.
  round: number;
  // The rolls made this round.
  rolls: number;
  // What the dice show; null until the round's first roll.
  dice: number[] | null;
  // The dice held through the last roll.
  held: boolean[];
  card: Card;
  // Yahtzee bonuses earned, each worth `YAHTZEE_BONUS`.
  bonuses: number;
  // Rounds scored on a Yahtzee, wherever it went.
  yahtzees: number;
  last: Scored | null;
}

// Every action names the round it was made for, and a roll also names which
// roll of the round it is. The page posts them one after another, so a button
// pressed twice before the first press landed sends the second for a round or
// roll already played, and that is dropped rather than rolling or scoring
// twice.
export type YahtzeeAction =
  | { t: "roll"; round: number; roll: number; hold: boolean[] }
  | { t: "score"; round: number; category: Category };

const Round = z
  .number()
  .int()
  .min(0)
  .max(ROUNDS - 1);

export const YahtzeeActionSchema: z.ZodType<YahtzeeAction> = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("roll"),
    round: Round,
    roll: z
      .number()
      .int()
      .min(0)
      .max(ROLLS - 1),
    hold: z.array(z.boolean()).length(DICE),
  }),
  z.object({ t: z.literal("score"), round: Round, category: z.enum(CATEGORIES) }),
]);

// Draws the day's dice from `seed`, the same for every player.
export function deal(seed: number): Faces {
  let rng = seed;
  const draw = () => {
    const [face, next] = nextInt(rng, FACES);
    rng = next;
    return face + 1;
  };
  return Array.from({ length: ROUNDS }, () =>
    Array.from({ length: ROLLS }, () => Array.from({ length: DICE }, draw)),
  );
}

// How many dice show each face: `counts[face]`, with `counts[0]` unused.
function countsOf(dice: readonly number[]): number[] {
  const counts = new Array<number>(FACES + 1).fill(0);
  for (const face of dice) counts[face]++;
  return counts;
}

const sum = (dice: readonly number[]) => dice.reduce((total, face) => total + face, 0);

// Whether the dice hold every face from `from` to `from + length - 1`.
function hasRun(counts: readonly number[], from: number, length: number): boolean {
  for (let face = from; face < from + length; face++) if (counts[face] === 0) return false;
  return true;
}

export function isYahtzee(dice: readonly number[]): boolean {
  return dice.every((face) => face === dice[0]);
}

// Whether `dice` are a joker on `card`: a Yahtzee with its box already filled.
export function isJoker(card: Card, dice: readonly number[]): boolean {
  return isYahtzee(dice) && card.yahtzee !== undefined;
}

// Whether `dice` earn a Yahtzee bonus on `card`, wherever they are scored:
// a Yahtzee rolled with 50 already in its box.
export function earnsBonus(card: Card, dice: readonly number[]): boolean {
  return isYahtzee(dice) && card.yahtzee === FIFTY;
}

// What `dice` score in `category`. As a joker, a full house or a straight
// scores in full.
export function points(category: Category, dice: readonly number[], joker = false): number {
  const counts = countsOf(dice);
  const most = Math.max(...counts);
  switch (category) {
    case "ones":
    case "twos":
    case "threes":
    case "fours":
    case "fives":
    case "sixes": {
      const face = UPPER.indexOf(category) + 1;
      return counts[face] * face;
    }
    case "threeKind":
      return most >= 3 ? sum(dice) : 0;
    case "fourKind":
      return most >= 4 ? sum(dice) : 0;
    case "fullHouse":
      return joker || (counts.includes(3) && counts.includes(2)) ? FULL_HOUSE : 0;
    case "smallStraight":
      return joker || [1, 2, 3].some((from) => hasRun(counts, from, 4)) ? SMALL_STRAIGHT : 0;
    case "largeStraight":
      return joker || [1, 2].some((from) => hasRun(counts, from, 5)) ? LARGE_STRAIGHT : 0;
    case "yahtzee":
      return most === DICE ? FIFTY : 0;
    case "chance":
      return sum(dice);
  }
}

// The boxes `dice` may be scored in: every open one, unless they are a
// joker, which goes where the joker rules send it.
export function choices(card: Card, dice: readonly number[]): Category[] {
  const open = CATEGORIES.filter((category) => card[category] === undefined);
  if (!isJoker(card, dice)) return open;
  const own = UPPER[dice[0] - 1];
  if (card[own] === undefined) return [own];
  const lower = LOWER.filter((category) => card[category] === undefined);
  return lower.length > 0 ? lower : open;
}

export function upperTotal(card: Card): number {
  return UPPER.reduce((total, category) => total + (card[category] ?? 0), 0);
}

export function upperBonus(card: Card): number {
  return upperTotal(card) >= UPPER_BONUS_AT ? UPPER_BONUS : 0;
}

export function lowerTotal(card: Card): number {
  return LOWER.reduce((total, category) => total + (card[category] ?? 0), 0);
}

export function total(card: Card, bonuses: number): number {
  return upperTotal(card) + upperBonus(card) + lowerTotal(card) + bonuses * YAHTZEE_BONUS;
}

export function isOver(state: YahtzeeState): boolean {
  return state.round >= ROUNDS;
}

const NOTHING_HELD: readonly boolean[] = new Array<boolean>(DICE).fill(false);

export function init(seed: number): YahtzeeState {
  return {
    faces: deal(seed),
    round: 0,
    rolls: 0,
    dice: null,
    held: NOTHING_HELD.slice(),
    card: {},
    bonuses: 0,
    yahtzees: 0,
    last: null,
  };
}

function rollDice(state: YahtzeeState, hold: readonly boolean[]): YahtzeeState {
  const { dice } = state;
  if (state.rolls >= ROLLS) throw new Error("the round has no rolls left");
  if (dice === null && hold.some(Boolean)) throw new Error("there are no dice to hold yet");
  if (hold.every(Boolean)) throw new Error("every die is held");
  const faces = state.faces[state.round][state.rolls];
  return {
    ...state,
    rolls: state.rolls + 1,
    dice: faces.map((face, die) => (hold[die] && dice ? dice[die] : face)),
    held: hold.slice(),
  };
}

function fill(state: YahtzeeState, category: Category): YahtzeeState {
  const { dice, card } = state;
  if (dice === null) throw new Error("roll the dice first");
  if (card[category] !== undefined) throw new Error("that box is already filled");
  if (!choices(card, dice).includes(category)) throw new Error("a joker cannot go in that box");
  const gained = points(category, dice, isJoker(card, dice));
  const bonus = earnsBonus(card, dice);
  return {
    ...state,
    round: state.round + 1,
    rolls: 0,
    dice: null,
    held: NOTHING_HELD.slice(),
    card: { ...card, [category]: gained },
    bonuses: state.bonuses + (bonus ? 1 : 0),
    yahtzees: state.yahtzees + (isYahtzee(dice) ? 1 : 0),
    last: { category, points: gained, bonus },
  };
}

// An action for a round or a roll already played changes nothing: it is a
// press the page sent again before the first landed.
export function reduce(state: YahtzeeState, action: YahtzeeAction): YahtzeeState {
  if (isOver(state)) throw new Error("the run is over");
  if (action.round !== state.round) return state;
  if (action.t === "score") return fill(state, action.category);
  if (action.roll !== state.rolls) return state;
  return rollDice(state, action.hold);
}

export interface YahtzeeView {
  round: number;
  rolls: number;
  dice: number[] | null;
  held: boolean[];
  card: Card;
  bonuses: number;
  last: Scored | null;
}

// Everything but the dice still to be thrown.
export function view(state: YahtzeeState): YahtzeeView {
  return {
    round: state.round,
    rolls: state.rolls,
    dice: state.dice?.slice() ?? null,
    held: state.held.slice(),
    card: { ...state.card },
    bonuses: state.bonuses,
    last: state.last && { ...state.last },
  };
}

// Every run ranks by its card's total, a full card or not. A full one says
// whether it made the upper bonus and how many Yahtzees it rolled; any
// other, how many boxes it left empty.
export function score(state: YahtzeeState): DailyScore {
  const value = total(state.card, state.bonuses);
  if (!isOver(state)) {
    const filled = Object.keys(state.card).length;
    return { value, detail: { key: "chart.ended", values: { count: ROUNDS - filled } } };
  }
  return {
    value,
    detail: {
      key: upperBonus(state.card) > 0 ? "chart.bonus" : "chart.plain",
      values: { count: state.yahtzees },
    },
  };
}

export const yahtzeeGame: DailyGameModule<YahtzeeState, YahtzeeAction> = {
  id: "yahtzee",
  meta: { name: "Yahtzee", order: "desc", format: "number" },
  actionSchema: YahtzeeActionSchema,
  init,
  reduce,
  view,
  finished: isOver,
  score,
};
