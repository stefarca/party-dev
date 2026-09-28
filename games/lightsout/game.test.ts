import { describe, expect, test } from "vitest";

import {
  CELLS,
  FLIPS,
  LightsOutActionSchema,
  MIN_PAR,
  deal,
  init,
  isSolved,
  lightsOutGame,
  litCount,
  press,
  reduce,
  score,
  solve,
  view,
} from "./game";
import type { LightsOutState } from "./game";

// A board drawn as five rows of five, "#" for a light on.
function board(rows: string): boolean[] {
  return rows
    .trim()
    .split(/\s+/)
    .join("")
    .split("")
    .map((c) => c === "#");
}

const DARK = new Array<boolean>(CELLS).fill(false);

function pressAll(lights: readonly boolean[], cells: readonly number[]): boolean[] {
  return cells.reduce<boolean[]>((acc, cell) => press(acc, cell), lights.slice());
}

// The two sets of presses that change nothing on a 5×5 board, and their sum.
// Any solution plus one of these is another solution, so between them they
// give every solution there is.
const QUIET = [
  board(".###. #.#.# ##.## #.#.# .###."),
  board("#.#.# #.#.# ..... #.#.# #.#.#"),
  board("##.## ..... ##.## ..... ##.##"),
].map((pattern) => pattern.flatMap((on, cell) => (on ? [cell] : [])));

function stateWith(lights: boolean[], par: number, startedAt = 1_000): LightsOutState {
  return { lights, par, presses: 0, startedAt, solvedAt: null };
}

describe("a press", () => {
  test("flips the light and the ones beside it, never diagonally", () => {
    expect(press(DARK, 12)).toEqual(board("..... ..#.. .###. ..#.. ....."));
    expect(press(DARK, 0)).toEqual(board("##... #.... ..... ..... ....."));
    expect(press(DARK, 9)).toEqual(board("....# ...## ....# ..... ....."));
    expect(FLIPS.map((bits) => bits.toString(2).split("1").length - 1).sort()).toEqual(
      [...Array(4).fill(3), ...Array(12).fill(4), ...Array(9).fill(5)].sort(),
    );
  });

  test("twice undoes itself, and leaves the board it was given alone", () => {
    const lights = board("#.#.# .#.#. #.#.# .#.#. #.#.#");
    const frozen = lights.slice();
    const once = press(lights, 7);
    expect(lights).toEqual(frozen);
    expect(once).not.toEqual(lights);
    expect(press(once, 7)).toEqual(lights);
  });
});

describe("the solver", () => {
  test("the quiet patterns really are quiet", () => {
    for (const cells of QUIET) expect(pressAll(DARK, cells)).toEqual(DARK);
  });

  test("finds one press for a board one press made", () => {
    expect(solve(press(DARK, 12))).toEqual([12]);
    expect(solve(DARK)).toEqual([]);
  });

  test("says when no presses can turn a board off", () => {
    // A lone light in a corner is flipped an odd number of times by one of
    // the quiet patterns, so no presses reach it alone.
    expect(solve(board("#.... ..... ..... ..... ....."))).toBeNull();
  });

  test("finds the shortest of every board's four solutions", () => {
    for (let seed = 0; seed < 100; seed++) {
      const { lights } = deal(seed);
      const presses = solve(lights) as number[];
      expect(pressAll(lights, presses)).toEqual(DARK);
      for (const quiet of QUIET) {
        const other = presses
          .filter((cell) => !quiet.includes(cell))
          .concat(quiet.filter((cell) => !presses.includes(cell)));
        expect(pressAll(lights, other)).toEqual(DARK);
        expect(presses.length).toBeLessThanOrEqual(other.length);
      }
    }
  });
});

describe("the deal", () => {
  test("is a board that can be solved, at par or above the floor", () => {
    for (let seed = 0; seed < 300; seed++) {
      const { lights, par } = deal(seed);
      expect(lights).toHaveLength(CELLS);
      expect(par).toBeGreaterThanOrEqual(MIN_PAR);
      expect(solve(lights)).toHaveLength(par);
    }
  });

  test("is the same for the same seed, and differs between seeds", () => {
    expect(deal(42)).toEqual(deal(42));
    expect(init(42, 5)).toEqual(init(42, 5));
    const boards = new Set(Array.from({ length: 50 }, (_, seed) => deal(seed).lights.join()));
    expect(boards.size).toBe(50);
  });
});

describe("the action schema", () => {
  test("takes a press on any light", () => {
    expect(LightsOutActionSchema.safeParse({ t: "press", cell: 0 }).success).toBe(true);
    expect(LightsOutActionSchema.safeParse({ t: "press", cell: CELLS - 1 }).success).toBe(true);
  });

  test.each([
    ["a cell off the board", { t: "press", cell: CELLS }],
    ["a negative cell", { t: "press", cell: -1 }],
    ["a fraction", { t: "press", cell: 1.5 }],
    ["another action", { t: "toggle", cell: 1 }],
  ])("refuses %s", (_, action) => {
    expect(LightsOutActionSchema.safeParse(action).success).toBe(false);
  });
});

describe("playing", () => {
  const LIGHTS = pressAll(DARK, [0, 12, 24]);

  test("a press flips the board and counts, without touching the state it was played on", () => {
    const state = stateWith(LIGHTS, 3);
    const frozen = structuredClone(state);
    const next = reduce(state, { t: "press", cell: 12 }, 2_000);
    expect(state).toEqual(frozen);
    expect(next).not.toBe(state);
    expect(next.lights).toEqual(press(LIGHTS, 12));
    expect(next.presses).toBe(1);
    expect(isSolved(next)).toBe(false);
  });

  test("turning the last light off ends the run, and scores the presses", () => {
    let state = stateWith(LIGHTS, 3, 1_000);
    state = reduce(state, { t: "press", cell: 0 }, 2_000);
    state = reduce(state, { t: "press", cell: 12 }, 3_000);
    state = reduce(state, { t: "press", cell: 24 }, 126_000);
    expect(litCount(state.lights)).toBe(0);
    expect(state.solvedAt).toBe(126_000);
    expect(lightsOutGame.finished(state)).toBe(true);
    expect(score(state)).toEqual({
      value: 3,
      detail: { key: "chart.par", values: { time: "2:05" } },
    });
    expect(() => reduce(state, { t: "press", cell: 0 }, 127_000)).toThrow();
  });

  test("a run over par still ranks, by every press it took", () => {
    let state = stateWith(LIGHTS, 3, 1_000);
    for (const cell of [5, 5, 0, 12, 24]) state = reduce(state, { t: "press", cell }, 62_000);
    expect(score(state)).toEqual({
      value: 5,
      detail: { key: "chart.solved", values: { time: "1:01" } },
    });
  });

  test("a run ended with lights on is unranked, and says how many", () => {
    const state = reduce(stateWith(LIGHTS, 3), { t: "press", cell: 0 }, 2_000);
    expect(score(state)).toEqual({
      value: null,
      detail: { key: "chart.ended", values: { count: litCount(state.lights) } },
    });
  });

  test("the same presses from the same seed play out the same", () => {
    const play = () => {
      let state = init(7, 1_000);
      for (const cell of [3, 11, 3, 20]) state = reduce(state, { t: "press", cell }, 2_000);
      return state;
    };
    expect(play()).toEqual(play());
  });

  test("the day's par solves the day's board", () => {
    let state = init(99, 1_000);
    for (const cell of solve(state.lights) as number[]) {
      state = reduce(state, { t: "press", cell }, 2_000);
    }
    expect(isSolved(state)).toBe(true);
    expect(state.presses).toBe(state.par);
  });
});

describe("the view", () => {
  test("shows the board and par, and nothing the seed could be read from", () => {
    const state = init(3, 1_000);
    expect(Object.keys(view(state)).sort()).toEqual([
      "lights",
      "par",
      "presses",
      "solvedAt",
      "startedAt",
    ]);
    expect(view(state).lights).toEqual(state.lights);
  });

  test("hands out copies, never the state's own arrays", () => {
    const state = init(3, 1_000);
    const shown = view(state);
    shown.lights[0] = !shown.lights[0];
    expect(state.lights[0]).not.toBe(shown.lights[0]);
  });
});
