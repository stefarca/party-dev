import { describe, expect, test } from "vitest";

import {
  CATEGORIES,
  DICE,
  FACES,
  LOWER,
  ROLLS,
  ROUNDS,
  UPPER,
  YahtzeeActionSchema,
  choices,
  deal,
  earnsBonus,
  init,
  isOver,
  points,
  reduce,
  score,
  total,
  upperBonus,
  view,
  yahtzeeGame,
} from "./game";
import type { Card, Category, Faces, YahtzeeAction, YahtzeeState } from "./game";

// Every roll of every round lands on `dice`, unless `rounds` says otherwise
// for that round: its first roll, or each of its rolls in turn.
function facesOf(dice: number[], rounds: Record<number, number[] | number[][]> = {}): Faces {
  return Array.from({ length: ROUNDS }, (_, round) => {
    const own = rounds[round];
    const rolls =
      own === undefined ? [dice] : Array.isArray(own[0]) ? (own as number[][]) : [own as number[]];
    return Array.from({ length: ROLLS }, (_, roll) => (rolls[roll] ?? rolls[0]).slice());
  });
}

function stateWith(faces: Faces, card: Card = {}, extra: Partial<YahtzeeState> = {}): YahtzeeState {
  return {
    faces,
    round: Object.keys(card).length,
    rolls: 0,
    dice: null,
    held: new Array(DICE).fill(false),
    card,
    bonuses: 0,
    yahtzees: 0,
    last: null,
    ...extra,
  };
}

const NONE = [false, false, false, false, false];

const roll = (state: YahtzeeState, hold: boolean[] = NONE): YahtzeeState =>
  reduce(state, { t: "roll", round: state.round, roll: state.rolls, hold });

const fill = (state: YahtzeeState, category: Category): YahtzeeState =>
  reduce(state, { t: "score", round: state.round, category });

// A card with every box in `categories` filled with `value`.
function cardWith(categories: readonly Category[], value = 0): Card {
  return Object.fromEntries(categories.map((category) => [category, value]));
}

describe("the day's dice", () => {
  test("are a face from 1 to 6 for every die of every roll of every round", () => {
    for (let seed = 0; seed < 50; seed++) {
      const faces = deal(seed);
      expect(faces).toHaveLength(ROUNDS);
      for (const rolls of faces) {
        expect(rolls).toHaveLength(ROLLS);
        for (const dice of rolls) {
          expect(dice).toHaveLength(DICE);
          for (const face of dice) {
            expect(Number.isInteger(face)).toBe(true);
            expect(face).toBeGreaterThanOrEqual(1);
            expect(face).toBeLessThanOrEqual(FACES);
          }
        }
      }
    }
  });

  test("land on every face about as often", () => {
    const counts = new Array<number>(FACES + 1).fill(0);
    for (let seed = 0; seed < 200; seed++) {
      for (const face of deal(seed).flat(2)) counts[face]++;
    }
    const expected = (200 * ROUNDS * ROLLS * DICE) / FACES;
    for (let face = 1; face <= FACES; face++) {
      expect(Math.abs(counts[face] - expected) / expected).toBeLessThan(0.05);
    }
  });

  test("are the same for the same seed, and differ between seeds", () => {
    expect(deal(42)).toEqual(deal(42));
    expect(init(42)).toEqual(init(42));
    const openings = new Set(Array.from({ length: 50 }, (_, seed) => deal(seed)[0][0].join()));
    expect(openings.size).toBeGreaterThan(40);
  });
});

describe("what dice score", () => {
  test.each<[Category, number[], number]>([
    ["ones", [1, 1, 3, 1, 6], 3],
    ["twos", [2, 5, 2, 2, 2], 8],
    ["threes", [1, 2, 4, 5, 6], 0],
    ["fours", [4, 4, 1, 2, 3], 8],
    ["fives", [5, 5, 5, 5, 5], 25],
    ["sixes", [6, 1, 6, 1, 6], 18],
    ["threeKind", [3, 3, 3, 5, 6], 20],
    ["threeKind", [3, 3, 3, 3, 6], 18],
    ["threeKind", [3, 3, 2, 5, 6], 0],
    ["fourKind", [2, 2, 2, 2, 6], 14],
    ["fourKind", [4, 4, 4, 4, 4], 20],
    ["fourKind", [2, 2, 2, 6, 6], 0],
    ["fullHouse", [2, 2, 3, 3, 3], 25],
    ["fullHouse", [6, 1, 6, 1, 1], 25],
    ["fullHouse", [2, 2, 2, 2, 3], 0],
    ["fullHouse", [4, 4, 4, 4, 4], 0],
    ["smallStraight", [1, 2, 3, 4, 6], 30],
    ["smallStraight", [3, 4, 2, 5, 5], 30],
    ["smallStraight", [6, 5, 4, 3, 1], 30],
    ["smallStraight", [1, 2, 3, 5, 6], 0],
    ["largeStraight", [5, 4, 3, 2, 1], 40],
    ["largeStraight", [2, 3, 4, 5, 6], 40],
    ["largeStraight", [1, 2, 3, 4, 6], 0],
    ["yahtzee", [6, 6, 6, 6, 6], 50],
    ["yahtzee", [6, 6, 6, 6, 5], 0],
    ["chance", [1, 3, 5, 6, 6], 21],
  ])("%s scores %j as %i", (category, dice, expected) => {
    expect(points(category, dice)).toBe(expected);
  });

  test("a joker scores a full house and the straights in full", () => {
    expect(points("fullHouse", [3, 3, 3, 3, 3], true)).toBe(25);
    expect(points("smallStraight", [3, 3, 3, 3, 3], true)).toBe(30);
    expect(points("largeStraight", [3, 3, 3, 3, 3], true)).toBe(40);
    expect(points("chance", [3, 3, 3, 3, 3], true)).toBe(15);
    expect(points("fourKind", [3, 3, 3, 3, 3], true)).toBe(15);
  });

  test("63 in the upper boxes earns the bonus, and 62 does not", () => {
    const card: Card = { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 };
    expect(upperBonus(card)).toBe(35);
    expect(upperBonus({ ...card, ones: 2 })).toBe(0);
    expect(total(card, 0)).toBe(63 + 35);
    expect(total({ ...card, chance: 20, yahtzee: 50 }, 2)).toBe(63 + 35 + 70 + 200);
  });
});

describe("where dice may go", () => {
  test("anywhere open, while they are not a joker", () => {
    const card = cardWith(["ones", "chance"]);
    expect(choices(card, [2, 3, 4, 5, 6])).toEqual(
      CATEGORIES.filter((category) => category !== "ones" && category !== "chance"),
    );
    // A Yahtzee with its own box still open is no joker.
    expect(choices({}, [4, 4, 4, 4, 4])).toEqual([...CATEGORIES]);
  });

  test("a joker goes in its own upper box while that is open", () => {
    expect(choices({ yahtzee: 50 }, [4, 4, 4, 4, 4])).toEqual(["fours"]);
    expect(choices({ yahtzee: 0 }, [4, 4, 4, 4, 4])).toEqual(["fours"]);
  });

  test("then in any open lower box", () => {
    const card: Card = { yahtzee: 50, fours: 16, fullHouse: 25 };
    expect(choices(card, [4, 4, 4, 4, 4])).toEqual(
      LOWER.filter((category) => category !== "yahtzee" && category !== "fullHouse"),
    );
  });

  test("and only then as a zero in an open upper box", () => {
    const card: Card = { ...cardWith(LOWER), yahtzee: 50, fours: 16, ones: 2 };
    expect(choices(card, [4, 4, 4, 4, 4])).toEqual(["twos", "threes", "fives", "sixes"]);
  });
});

describe("a round", () => {
  test("opens with the day's first roll, without touching the state it was played on", () => {
    const state = stateWith(facesOf([2, 3, 4, 5, 6], { 0: [6, 6, 1, 2, 3] }));
    const frozen = structuredClone(state);
    const next = roll(state);
    expect(state).toEqual(frozen);
    expect(next).not.toBe(state);
    expect(next.dice).toEqual([6, 6, 1, 2, 3]);
    expect(next.rolls).toBe(1);
  });

  test("keeps the held dice and throws the rest onto that roll's faces", () => {
    const faces = facesOf([1, 1, 1, 1, 1], {
      0: [
        [6, 6, 1, 2, 3],
        [5, 5, 5, 5, 5],
        [4, 4, 4, 4, 4],
      ],
    });
    let state = roll(stateWith(faces));
    state = roll(state, [true, true, false, false, false]);
    expect(state.dice).toEqual([6, 6, 5, 5, 5]);
    expect(state.held).toEqual([true, true, false, false, false]);
    state = roll(state, [true, false, true, false, false]);
    expect(state.dice).toEqual([6, 4, 5, 4, 4]);
    expect(state.rolls).toBe(3);
  });

  test("gives every player who throws a die the same face for it", () => {
    const faces = deal(99);
    const held = roll(roll(stateWith(faces)), [true, false, true, false, true]);
    const thrown = roll(roll(stateWith(faces)), [false, false, false, false, false]);
    // Dice 2 and 4 were thrown by both.
    expect([held.dice![1], held.dice![3]]).toEqual([thrown.dice![1], thrown.dice![3]]);
    expect(thrown.dice).toEqual(faces[0][1]);
  });

  test("holds nothing before the first roll, and never every die", () => {
    const state = stateWith(facesOf([1, 2, 3, 4, 5]));
    expect(() => roll(state, [true, false, false, false, false])).toThrow();
    const rolled = roll(state);
    expect(() => roll(rolled, [true, true, true, true, true])).toThrow();
  });

  test("has three rolls, and a fourth changes nothing", () => {
    const state = roll(roll(roll(stateWith(facesOf([1, 2, 3, 4, 5])))));
    expect(state.rolls).toBe(ROLLS);
    // A fourth can only be named as a roll already made.
    expect(reduce(state, { t: "roll", round: 0, roll: ROLLS - 1, hold: NONE })).toBe(state);
    expect(
      YahtzeeActionSchema.safeParse({ t: "roll", round: 0, roll: ROLLS, hold: NONE }).success,
    ).toBe(false);
  });

  test("ends when its dice are scored, and the next one waits for its first roll", () => {
    let state = roll(stateWith(facesOf([2, 3, 4, 5, 6])));
    state = fill(state, "largeStraight");
    expect(state.card).toEqual({ largeStraight: 40 });
    expect(state.round).toBe(1);
    expect(state.rolls).toBe(0);
    expect(state.dice).toBeNull();
    expect(state.held).toEqual(NONE);
    expect(state.last).toEqual({ category: "largeStraight", points: 40, bonus: false });
  });

  test("scores a zero where the dice do not fit", () => {
    const state = fill(roll(stateWith(facesOf([2, 3, 4, 5, 6]))), "yahtzee");
    expect(state.card).toEqual({ yahtzee: 0 });
  });

  test("cannot be scored before a roll, nor in a filled box, nor where a joker may not go", () => {
    const fresh = stateWith(facesOf([1, 2, 3, 4, 5]));
    expect(() => fill(fresh, "chance")).toThrow();
    const rolled = roll(stateWith(facesOf([1, 2, 3, 4, 5]), { chance: 15 }));
    expect(() => fill(rolled, "chance")).toThrow();
    const joker = roll(stateWith(facesOf([3, 3, 3, 3, 3]), { yahtzee: 50 }));
    expect(() => fill(joker, "chance")).toThrow();
  });
});

describe("a press sent twice", () => {
  test("rolls once", () => {
    const state = roll(stateWith(facesOf([1, 2, 3, 4, 5])));
    const again: YahtzeeAction = { t: "roll", round: 0, roll: 0, hold: NONE };
    expect(reduce(state, again)).toBe(state);
  });

  test("scores once, whichever box the second names", () => {
    const state = fill(roll(stateWith(facesOf([1, 2, 3, 4, 5]))), "chance");
    expect(reduce(state, { t: "score", round: 0, category: "chance" })).toBe(state);
    expect(reduce(state, { t: "score", round: 0, category: "ones" })).toBe(state);
    // A roll pressed before the score landed is for the round just scored.
    expect(reduce(state, { t: "roll", round: 0, roll: 1, hold: NONE })).toBe(state);
  });
});

describe("Yahtzees", () => {
  const fives = facesOf([5, 5, 5, 5, 5]);

  test("earn a bonus of 100 once the box holds 50, and are jokers", () => {
    let state = fill(roll(stateWith(fives)), "yahtzee");
    expect(state.card.yahtzee).toBe(50);
    state = fill(roll(state), "fives");
    expect(state.last).toEqual({ category: "fives", points: 25, bonus: true });
    state = fill(roll(state), "largeStraight");
    expect(state.last).toEqual({ category: "largeStraight", points: 40, bonus: true });
    expect(state.bonuses).toBe(2);
    expect(state.yahtzees).toBe(3);
    expect(total(state.card, state.bonuses)).toBe(50 + 25 + 40 + 200);
  });

  test("earn no bonus once the box holds a zero, but are jokers still", () => {
    let state = fill(roll(stateWith(facesOf([1, 2, 3, 4, 6], { 1: [2, 2, 2, 2, 2] }))), "yahtzee");
    expect(state.card.yahtzee).toBe(0);
    state = roll(state);
    expect(choices(state.card, state.dice!)).toEqual(["twos"]);
    state = fill(state, "twos");
    expect(state.last).toEqual({ category: "twos", points: 10, bonus: false });
    expect(state.bonuses).toBe(0);
  });

  test("say whether they earn the bonus before they are scored", () => {
    expect(earnsBonus({ yahtzee: 50 }, [2, 2, 2, 2, 2])).toBe(true);
    expect(earnsBonus({ yahtzee: 0 }, [2, 2, 2, 2, 2])).toBe(false);
    expect(earnsBonus({}, [2, 2, 2, 2, 2])).toBe(false);
    expect(earnsBonus({ yahtzee: 50 }, [2, 2, 2, 2, 3])).toBe(false);
  });

  test("scored anywhere while the box is open earn no bonus", () => {
    const state = fill(roll(stateWith(fives)), "chance");
    expect(state.last).toEqual({ category: "chance", points: 25, bonus: false });
    expect(state.card.yahtzee).toBeUndefined();
  });
});

describe("a run", () => {
  // Scores each round's first roll in the first open box of `order`.
  function play(state: YahtzeeState, order: readonly Category[]): YahtzeeState {
    for (const category of order) state = fill(roll(state), category);
    return state;
  }

  test("is over once all thirteen boxes are filled", () => {
    const upper = facesOf([1, 1, 1, 1, 1], {
      0: [1, 1, 1, 2, 3],
      1: [2, 2, 2, 5, 6],
      2: [3, 3, 3, 1, 1],
      3: [4, 4, 4, 1, 2],
      4: [5, 5, 5, 6, 6],
      5: [6, 6, 6, 1, 1],
      6: [2, 2, 3, 3, 3],
      7: [1, 2, 3, 4, 6],
      8: [2, 3, 4, 5, 6],
      9: [4, 4, 4, 4, 6],
      10: [6, 6, 6, 5, 5],
      11: [1, 3, 5, 6, 6],
    });
    const state = play(stateWith(upper), [
      "ones",
      "twos",
      "threes",
      "fours",
      "fives",
      "sixes",
      "fullHouse",
      "smallStraight",
      "largeStraight",
      "fourKind",
      "threeKind",
      "chance",
      "yahtzee",
    ]);
    expect(isOver(state)).toBe(true);
    expect(yahtzeeGame.finished(state)).toBe(true);
    // 3 + 6 + 9 + 12 + 15 + 18 = 63 above, and the bonus.
    expect(score(state)).toEqual({
      value: 63 + 35 + 25 + 30 + 40 + 22 + 28 + 21 + 50,
      detail: { key: "chart.bonus", values: { count: 1 } },
    });
    expect(() => roll(state)).toThrow();
  });

  test("without the upper bonus says so", () => {
    const state = play(stateWith(facesOf([1, 2, 3, 4, 6])), CATEGORIES);
    expect(score(state)).toEqual({
      value: total(state.card, 0),
      detail: { key: "chart.plain", values: { count: 0 } },
    });
  });

  test("ended early ranks by its total so far, and says how many boxes it left", () => {
    let state = play(stateWith(facesOf([6, 6, 6, 6, 6])), ["yahtzee", "sixes"]);
    state = roll(state);
    expect(yahtzeeGame.finished(state)).toBe(false);
    expect(score(state)).toEqual({
      value: 50 + 30 + 100,
      detail: { key: "chart.ended", values: { count: ROUNDS - 2 } },
    });
  });

  test("plays out the same from the same seed and presses", () => {
    const run = () => {
      let state = init(7);
      state = roll(state);
      state = roll(state, [true, false, true, false, false]);
      state = fill(state, "chance");
      state = roll(state);
      return fill(state, "ones");
    };
    expect(run()).toEqual(run());
  });
});

describe("the action schema", () => {
  test.each<[string, unknown]>([
    ["a roll", { t: "roll", round: 12, roll: 2, hold: [true, false, true, false, true] }],
    ["a score", { t: "score", round: 0, category: "smallStraight" }],
  ])("takes %s", (_, action) => {
    expect(YahtzeeActionSchema.safeParse(action).success).toBe(true);
  });

  test.each<[string, unknown]>([
    ["a round past the card", { t: "score", round: ROUNDS, category: "chance" }],
    ["a box that is not on the card", { t: "score", round: 0, category: "bonus" }],
    ["four holds", { t: "roll", round: 0, roll: 1, hold: [true, true, true, true] }],
    ["a fractional roll", { t: "roll", round: 0, roll: 0.5, hold: NONE }],
  ])("refuses %s", (_, action) => {
    expect(YahtzeeActionSchema.safeParse(action).success).toBe(false);
  });
});

describe("the view", () => {
  test("never carries the dice still to be thrown, before or after the run is over", () => {
    let state = init(123);
    expect(Object.keys(view(state)).sort()).toEqual([
      "bonuses",
      "card",
      "dice",
      "held",
      "last",
      "rolls",
      "round",
    ]);
    for (const category of CATEGORIES) state = fill(roll(state), category);
    expect(isOver(state)).toBe(true);
    const shown = view(state);
    expect(shown).not.toHaveProperty("faces");
    expect(JSON.stringify(shown)).not.toContain("faces");
  });

  test("hands out copies, never the state's own arrays", () => {
    const state = roll(stateWith(facesOf([1, 2, 3, 4, 5]), { chance: 20 }));
    const shown = view(state);
    shown.dice![0] = 6;
    shown.held[0] = true;
    shown.card.chance = 0;
    expect(state.dice![0]).toBe(1);
    expect(state.held[0]).toBe(false);
    expect(state.card.chance).toBe(20);
  });

  test("names the upper boxes in face order", () => {
    expect(UPPER.map((category) => points(category, [1, 2, 3, 4, 5]))).toEqual([1, 2, 3, 4, 5, 0]);
  });
});
