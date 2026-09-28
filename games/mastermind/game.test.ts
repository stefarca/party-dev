import { describe, expect, test } from "vitest";

import {
  COLORS,
  MAX_GUESSES,
  MastermindActionSchema,
  PEGS,
  deal,
  init,
  isOver,
  mark,
  mastermindGame,
  reduce,
  score,
  view,
} from "./game";
import type { MastermindState } from "./game";

function stateWith(secret: number[], startedAt = 1_000): MastermindState {
  return { secret, guesses: [], startedAt, solvedAt: null };
}

const SECRET = [0, 1, 2, 3, 4];

// Seven different guesses, none of them SECRET.
const WRONG = [
  [1, 0, 2, 3, 4],
  [2, 1, 0, 3, 4],
  [3, 1, 2, 0, 4],
  [4, 1, 2, 3, 0],
  [0, 2, 1, 3, 4],
  [0, 3, 2, 1, 4],
  [0, 4, 2, 3, 1],
];

describe("the code", () => {
  test("is five different colours of the seven", () => {
    for (let seed = 0; seed < 200; seed++) {
      const code = deal(seed);
      expect(code).toHaveLength(PEGS);
      expect(new Set(code).size).toBe(PEGS);
      for (const color of code) {
        expect(color).toBeGreaterThanOrEqual(0);
        expect(color).toBeLessThan(COLORS);
      }
    }
  });

  test("is the same for the same seed, and differs between seeds", () => {
    expect(deal(42)).toEqual(deal(42));
    expect(init(42, 5)).toEqual(init(42, 5));
    const codes = new Set(Array.from({ length: 50 }, (_, seed) => deal(seed).join()));
    expect(codes.size).toBeGreaterThan(40);
  });
});

describe("marking a guess", () => {
  test.each([
    [[0, 1, 2, 3, 4], 5, 0],
    [[4, 3, 2, 1, 0], 1, 4],
    [[5, 6, 0, 1, 2], 0, 3],
    [[0, 1, 2, 5, 6], 3, 0],
    [[1, 0, 5, 3, 6], 1, 2],
  ])("%j scores %i in place and %i elsewhere", (guess, exact, near) => {
    expect(mark(SECRET, guess)).toEqual({ pegs: guess, exact, near });
  });
});

describe("the action schema", () => {
  test("takes five different colours", () => {
    expect(MastermindActionSchema.safeParse({ t: "guess", pegs: [6, 5, 4, 3, 2] }).success).toBe(
      true,
    );
  });

  test.each([
    ["a repeated colour", [0, 0, 1, 2, 3]],
    ["too few pegs", [0, 1, 2, 3]],
    ["too many pegs", [0, 1, 2, 3, 4, 5]],
    ["a colour off the palette", [0, 1, 2, 3, 7]],
    ["a fraction", [0, 1, 2, 3, 0.5]],
  ])("refuses %s", (_, pegs) => {
    expect(MastermindActionSchema.safeParse({ t: "guess", pegs }).success).toBe(false);
  });
});

describe("playing", () => {
  test("a guess is marked and kept, without touching the state it was played on", () => {
    const state = stateWith(SECRET);
    const frozen = structuredClone(state);
    const next = reduce(state, { t: "guess", pegs: [4, 3, 2, 1, 0] }, 2_000);
    expect(state).toEqual(frozen);
    expect(next).not.toBe(state);
    expect(next.guesses).toEqual([{ pegs: [4, 3, 2, 1, 0], exact: 1, near: 4 }]);
    expect(next.solvedAt).toBeNull();
    expect(isOver(next)).toBe(false);
  });

  test("cracking the code ends the run, and scores the guesses it took", () => {
    let state = stateWith(SECRET, 1_000);
    state = reduce(state, { t: "guess", pegs: [4, 3, 2, 1, 0] }, 2_000);
    state = reduce(state, { t: "guess", pegs: [0, 1, 2, 3, 4] }, 126_000);
    expect(state.solvedAt).toBe(126_000);
    expect(isOver(state)).toBe(true);
    expect(mastermindGame.finished(state)).toBe(true);
    expect(score(state)).toEqual({
      value: 2,
      detail: { key: "chart.solved", values: { time: "2:05" } },
    });
    expect(() => reduce(state, { t: "guess", pegs: [4, 3, 2, 1, 0] }, 127_000)).toThrow();
  });

  test("the seventh wrong guess ends the run, unranked", () => {
    let state = stateWith(SECRET);
    WRONG.forEach((pegs, i) => {
      expect(isOver(state)).toBe(false);
      state = reduce(state, { t: "guess", pegs }, 2_000 + i);
    });
    expect(state.guesses).toHaveLength(MAX_GUESSES);
    expect(isOver(state)).toBe(true);
    expect(score(state)).toEqual({
      value: null,
      detail: { key: "chart.failed", values: { count: MAX_GUESSES } },
    });
    expect(() => reduce(state, { t: "guess", pegs: SECRET }, 3_000)).toThrow();
  });

  test("a guess already made spends nothing", () => {
    const once = reduce(stateWith(SECRET), { t: "guess", pegs: [4, 3, 2, 1, 0] }, 2_000);
    expect(reduce(once, { t: "guess", pegs: [4, 3, 2, 1, 0] }, 3_000)).toBe(once);
  });

  test("a run ended early is unranked, and says how far it got", () => {
    const state = reduce(stateWith(SECRET), { t: "guess", pegs: [4, 3, 2, 1, 0] }, 2_000);
    expect(score(state)).toEqual({
      value: null,
      detail: { key: "chart.ended", values: { count: 1 } },
    });
  });

  test("the same guesses from the same seed play out the same", () => {
    const play = () => {
      let state = init(7, 1_000);
      state = reduce(state, { t: "guess", pegs: [0, 1, 2, 3, 4] }, 2_000);
      state = reduce(state, { t: "guess", pegs: [6, 5, 4, 3, 2] }, 3_000);
      return state;
    };
    expect(play()).toEqual(play());
  });
});

describe("the view", () => {
  test("never carries the code, before or after the run is over", () => {
    let state = stateWith([6, 5, 4, 3, 2]);
    expect(Object.keys(view(state)).sort()).toEqual(["guesses", "solvedAt", "startedAt"]);
    WRONG.forEach((pegs, i) => {
      state = reduce(state, { t: "guess", pegs }, 2_000 + i);
    });
    expect(isOver(state)).toBe(true);
    const shown = view(state);
    expect(shown).not.toHaveProperty("secret");
    expect(JSON.stringify(shown)).not.toContain("secret");
    expect(shown.guesses).toEqual(state.guesses);
  });

  test("hands out copies, never the state's own arrays", () => {
    const state = reduce(stateWith(SECRET), { t: "guess", pegs: [4, 3, 2, 1, 0] }, 2_000);
    const shown = view(state);
    shown.guesses[0].pegs[0] = 6;
    expect(state.guesses[0].pegs[0]).toBe(4);
  });
});
