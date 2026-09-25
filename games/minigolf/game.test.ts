import { describe, expect, test } from "vitest";

import { nextInt } from "../../shared/prng";
import {
  BALL_R,
  COURSE,
  FIELD_H,
  FIELD_W,
  HOLES_PER_ROUND,
  HOLE_CAP,
  MAX_STROKES,
  MIN_POWER,
  MinigolfActionSchema,
  fits,
  init,
  inside,
  isOver,
  layOut,
  minigolfGame,
  mirror,
  parOf,
  reduce,
  roll,
  score,
  total,
  view,
} from "./game";
import type { Hole, MinigolfState, Point } from "./game";

type Shot = [angle: number, power: number];

// A way to play every hole of the course in par, as drawn and mirrored, found
// by searching over angle and power. The rolls are deterministic, so each of
// these holes out exactly the same way every time; a change to the physics or
// to a hole that breaks one has made that hole harder than its par says.
const IN_PAR: [plain: Shot[], mirrored: Shot[]][] = [
  [[[12, 0.79]], [[12, 0.79]]],
  [[[321, 0.88]], [[39, 0.88]]],
  [
    [
      [297, 1],
      [72, 0.82],
    ],
    [
      [63, 1],
      [9, 0.43],
    ],
  ],
  [[[36, 1]], [[9, 0.91]]],
  [[[48, 0.91]], [[303, 0.85]]],
  [
    [
      [66, 1],
      [21, 0.82],
    ],
    [
      [294, 1],
      [39, 0.88],
    ],
  ],
  [[[9, 0.85]], [[21, 0.88]]],
  [[[12, 0.58]], [[12, 0.76]]],
  [
    [
      [330, 1],
      [117, 0.73],
    ],
    [
      [30, 1],
      [117, 0.73],
    ],
  ],
  [[[18, 0.82]], [[18, 0.82]]],
  [[[21, 0.61]], [[192, 0.91]]],
  [[[6, 0.7]], [[3, 0.64]]],
  [[[42, 0.7]], [[318, 0.7]]],
  [[[30, 0.91]], [[210, 1]]],
  [[[45, 0.88]], [[45, 0.88]]],
  [
    [
      [54, 0.88],
      [9, 0.37],
    ],
    [
      [306, 0.88],
      [42, 0.46],
    ],
  ],
  [[[0, 0.76]], [[0, 0.76]]],
  [[[24, 0.94]], [[24, 0.94]]],
];

function plainHole(parts: Partial<Hole> = {}): Hole {
  return {
    par: 2,
    edge: [
      [20, 8],
      [80, 8],
      [80, 122],
      [20, 122],
    ],
    blocks: [],
    sand: [],
    water: [],
    slopes: [],
    tee: [50, 110],
    cup: [50, 20],
    ...parts,
  };
}

function stateWith(course: Hole[]): MinigolfState {
  return { course, hole: 0, ball: course[0].tee, strokes: 0, cards: [], shots: 0, last: null };
}

function shoot(state: MinigolfState, angle: number, power: number): MinigolfState {
  return reduce(state, { t: "shot", n: state.shots, angle, power });
}

// Points along a path, as pairs.
function pointsOf(path: number[]): Point[] {
  return Array.from({ length: path.length / 2 }, (_, i) => [path[2 * i], path[2 * i + 1]]);
}

describe("the course", () => {
  test.each(COURSE.map((hole, i) => [i, hole] as const))(
    "hole %i has its tee and cup on open ground inside the field",
    (_, hole) => {
      for (const variant of [hole, mirror(hole)]) {
        for (const [x, y] of [variant.tee, variant.cup]) {
          expect(fits(variant, x, y)).toBe(true);
          expect(variant.water.some((area) => inside(area, x, y))).toBe(false);
        }
        expect(variant.slopes.some(({ area }) => inside(area, ...variant.tee))).toBe(false);
        for (const [x, y] of variant.edge) {
          expect(x).toBeGreaterThanOrEqual(3);
          expect(x).toBeLessThanOrEqual(FIELD_W - 3);
          expect(y).toBeGreaterThanOrEqual(3);
          expect(y).toBeLessThanOrEqual(FIELD_H - 3);
        }
      }
    },
  );

  test("holds a way to play every hole in par", () => {
    expect(IN_PAR).toHaveLength(COURSE.length);
  });

  test.each(COURSE.map((hole, i) => [i, hole] as const))(
    "hole %i can be played in par, as drawn and mirrored",
    (i, hole) => {
      for (const [variant, shots] of [
        [hole, IN_PAR[i][0]],
        [mirror(hole), IN_PAR[i][1]],
      ] as const) {
        let state = stateWith([variant]);
        for (const [angle, power] of shots) state = shoot(state, angle, power);
        expect(state.cards).toEqual([shots.length]);
        expect(shots.length).toBeLessThanOrEqual(variant.par);
      }
    },
  );

  test("mirroring swaps left and right, and nothing else", () => {
    const hole = COURSE.find((candidate) => candidate.slopes.length > 0)!;
    const flipped = mirror(hole);
    expect(flipped.tee).toEqual([FIELD_W - hole.tee[0], hole.tee[1]]);
    expect(flipped.cup).toEqual([FIELD_W - hole.cup[0], hole.cup[1]]);
    expect(flipped.par).toBe(hole.par);
    for (const [i, slope] of hole.slopes.entries()) {
      expect(flipped.slopes[i].fall[0]).toBe(slope.fall[0] === 0 ? 0 : -slope.fall[0]);
      expect(flipped.slopes[i].fall[1]).toBe(slope.fall[1]);
    }
    expect(mirror(flipped)).toEqual(hole);
  });
});

describe("the day's round", () => {
  test("is six different holes of the course, the same for the same seed", () => {
    for (let seed = 0; seed < 100; seed++) {
      const course = layOut(seed);
      expect(course).toHaveLength(HOLES_PER_ROUND);
      const drawn = course.map((hole) =>
        COURSE.findIndex(
          (candidate) =>
            candidate === hole || JSON.stringify(mirror(candidate)) === JSON.stringify(hole),
        ),
      );
      expect(drawn.every((i) => i >= 0)).toBe(true);
      expect(new Set(drawn).size).toBe(HOLES_PER_ROUND);
    }
    expect(layOut(7)).toEqual(layOut(7));
    expect(init(7)).toEqual(init(7));
  });

  test("differs from day to day, and plays holes both ways round", () => {
    const rounds = new Set(Array.from({ length: 50 }, (_, seed) => JSON.stringify(layOut(seed))));
    expect(rounds.size).toBe(50);
    const mirrored = Array.from({ length: 50 }, (_, seed) => layOut(seed))
      .flat()
      .filter((hole) => !COURSE.includes(hole));
    expect(mirrored.length).toBeGreaterThan(0);
  });

  test("starts on the first hole's tee, with nothing played", () => {
    const state = init(3);
    expect(state.hole).toBe(0);
    expect(state.ball).toEqual(state.course[0].tee);
    expect(state.strokes).toBe(0);
    expect(state.cards).toEqual([]);
    expect(isOver(state)).toBe(false);
  });
});

describe("rolling the ball", () => {
  test("never leaves the course, never ends inside a wall, and always stops", () => {
    let rng = 12345;
    const draw = (max: number) => {
      const [value, next] = nextInt(rng, max);
      rng = next;
      return value;
    };
    for (const hole of COURSE.flatMap((plain) => [plain, mirror(plain)])) {
      let from = hole.tee;
      for (let shot = 0; shot < 25; shot++) {
        const angle = draw(360);
        const power = MIN_POWER + (draw(96) / 100) * (1 - MIN_POWER);
        const rolled = roll(hole, from, angle, power);
        // The time cap is twelve seconds; nothing should come near it.
        expect(rolled.path.length / 2).toBeLessThan(12 * 60);
        for (const [x, y] of pointsOf(rolled.path)) {
          expect(inside(hole.edge, x, y)).toBe(true);
          expect(hole.blocks.some((block) => inside(block, x, y))).toBe(false);
        }
        if (rolled.outcome === "rest") {
          expect(restsOnCourse(hole, rolled.end)).toBe(true);
          from = rolled.end;
        }
      }
    }
  });

  test("bounces off a wall rather than passing through it", () => {
    const hole = plainHole();
    const rolled = roll(hole, hole.tee, 180, 0.6);
    const ys = pointsOf(rolled.path).map(([, y]) => y);
    expect(Math.max(...ys)).toBeLessThanOrEqual(122 - BALL_R + 1e-6);
    expect(rolled.end[1]).toBeLessThan(hole.tee[1]);
  });

  test("drops a ball that reaches the cup slowly, and rattles a fast one across it", () => {
    const hole = plainHole({ cup: [50, 96] });
    // Fourteen units short of the tee: just enough to get there.
    expect(roll(hole, hole.tee, 0, 0.3).outcome).toBe("holed");
    expect(roll(hole, hole.tee, 0, 1).outcome).toBe("rest");
  });

  test("ends a holed shot's path in the cup", () => {
    const hole = plainHole({ cup: [50, 96] });
    const rolled = roll(hole, hole.tee, 0, 0.3);
    expect(rolled.path.slice(-2)).toEqual(hole.cup);
    expect(rolled.path.slice(0, 2)).toEqual(hole.tee);
  });

  test("slows in sand", () => {
    const open = plainHole();
    const bunker = plainHole({
      sand: [
        [
          [20, 40],
          [80, 40],
          [80, 100],
          [20, 100],
        ],
      ],
    });
    const onGrass = roll(open, open.tee, 0, 0.5).end;
    const inSand = roll(bunker, bunker.tee, 0, 0.5).end;
    expect(inSand[1]).toBeGreaterThan(onGrass[1]);
  });

  test("rolls back down a slope it was hit too softly to climb", () => {
    const hole = plainHole({
      slopes: [
        {
          area: [
            [20, 40],
            [80, 40],
            [80, 100],
            [20, 100],
          ],
          fall: [0, 1],
        },
      ],
    });
    const rolled = roll(hole, hole.tee, 0, 0.35);
    const ys = pointsOf(rolled.path).map(([, y]) => y);
    expect(Math.min(...ys)).toBeLessThan(100);
    // Off the bottom of the slope, where it can come to rest.
    expect(rolled.end[1]).toBeGreaterThanOrEqual(100);
  });

  test("stops at the water's edge in a splash", () => {
    const hole = plainHole({
      water: [
        [
          [20, 60],
          [80, 60],
          [80, 80],
          [20, 80],
        ],
      ],
    });
    const rolled = roll(hole, hole.tee, 0, 0.8);
    expect(rolled.outcome).toBe("water");
    expect(inside(hole.water[0], ...rolled.end)).toBe(true);
  });
});

// Whether a ball stopped at `at` is on the course: clear of every wall, or
// against one, where pushing it out of one corner wall can leave it a
// hundredth of a unit inside the other.
function restsOnCourse(hole: Hole, [x, y]: Point): boolean {
  for (const dx of [0, -0.01, 0.01]) {
    for (const dy of [0, -0.01, 0.01]) {
      if (fits(hole, x + dx, y + dy)) return true;
    }
  }
  return false;
}

describe("playing a hole", () => {
  test("counts a stroke and leaves the ball where it stopped", () => {
    const hole = plainHole();
    const state = shoot(stateWith([hole, hole]), 0, 0.3);
    expect(state.strokes).toBe(1);
    expect(state.shots).toBe(1);
    expect(state.ball[1]).toBeLessThan(hole.tee[1]);
    expect(state.last).toMatchObject({ hole: 0, from: hole.tee, outcome: "rest", strokes: 1 });
    expect(state.last?.card).toBeNull();
  });

  test("scores a holed ball and moves on to the next hole's tee", () => {
    const first = plainHole({ cup: [50, 96] });
    const second = plainHole({ tee: [40, 112] });
    const state = shoot(stateWith([first, second]), 0, 0.3);
    expect(state.cards).toEqual([1]);
    expect(state.hole).toBe(1);
    expect(state.ball).toEqual(second.tee);
    expect(state.strokes).toBe(0);
    expect(state.last).toMatchObject({ hole: 0, outcome: "holed", strokes: 1, card: 1 });
  });

  test("costs a penalty stroke for water, and puts the ball back", () => {
    const hole = plainHole({
      water: [
        [
          [20, 60],
          [80, 60],
          [80, 80],
          [20, 80],
        ],
      ],
    });
    const state = shoot(stateWith([hole, hole]), 0, 0.8);
    expect(state.strokes).toBe(2);
    expect(state.ball).toEqual(hole.tee);
    expect(state.last).toMatchObject({ outcome: "water", strokes: 2, card: null });
  });

  test(`picks the ball up after ${MAX_STROKES} strokes, and the hole scores ${HOLE_CAP}`, () => {
    const hole = plainHole();
    let state = stateWith([hole, hole]);
    for (let stroke = 1; stroke < MAX_STROKES; stroke++) {
      state = shoot(state, 90, MIN_POWER);
      expect(state.hole).toBe(0);
    }
    state = shoot(state, 90, MIN_POWER);
    expect(state.cards).toEqual([HOLE_CAP]);
    expect(state.hole).toBe(1);
    expect(state.last).toMatchObject({ outcome: "rest", strokes: MAX_STROKES, card: HOLE_CAP });
  });

  test("picks the ball up when a penalty takes it past the limit", () => {
    const hole = plainHole({
      water: [
        [
          [20, 60],
          [80, 60],
          [80, 80],
          [20, 80],
        ],
      ],
    });
    let state = stateWith([hole, hole]);
    for (let stroke = 1; stroke < MAX_STROKES; stroke++) state = shoot(state, 90, MIN_POWER);
    state = shoot(state, 0, 0.8);
    expect(state.cards).toEqual([HOLE_CAP]);
    expect(state.last).toMatchObject({ outcome: "water", strokes: MAX_STROKES + 1 });
  });

  test("plays a shot sent twice only once", () => {
    const hole = plainHole();
    const state = stateWith([hole, hole]);
    const once = reduce(state, { t: "shot", n: 0, angle: 0, power: 0.3 });
    expect(reduce(once, { t: "shot", n: 0, angle: 0, power: 0.3 })).toBe(once);
  });

  test("ends the round on the last hole, and takes no more shots", () => {
    const hole = plainHole({ cup: [50, 96] });
    let state = stateWith(Array.from({ length: HOLES_PER_ROUND }, () => hole));
    for (let i = 0; i < HOLES_PER_ROUND; i++) state = shoot(state, 0, 0.3);
    expect(isOver(state)).toBe(true);
    expect(state.cards).toEqual(Array.from({ length: HOLES_PER_ROUND }, () => 1));
    expect(() => shoot(state, 0, 0.3)).toThrow();
  });
});

describe("the action schema", () => {
  test("takes a shot", () => {
    expect(
      MinigolfActionSchema.safeParse({ t: "shot", n: 0, angle: 359.5, power: 1 }).success,
    ).toBe(true);
  });

  test.each([
    ["too little power", { t: "shot", n: 0, angle: 0, power: 0.01 }],
    ["too much power", { t: "shot", n: 0, angle: 0, power: 1.5 }],
    ["a negative angle", { t: "shot", n: 0, angle: -1, power: 0.5 }],
    ["an angle past a full turn", { t: "shot", n: 0, angle: 361, power: 0.5 }],
    ["no shot count", { t: "shot", angle: 0, power: 0.5 }],
    ["a fractional shot count", { t: "shot", n: 0.5, angle: 0, power: 0.5 }],
    ["something else", { t: "putt", n: 0, angle: 0, power: 0.5 }],
  ])("refuses %s", (_, action) => {
    expect(MinigolfActionSchema.safeParse(action).success).toBe(false);
  });
});

describe("scoring", () => {
  test("totals a finished round, and says how it stands to par", () => {
    const hole = plainHole({ par: 2, cup: [50, 96] });
    let state = stateWith(Array.from({ length: HOLES_PER_ROUND }, () => hole));
    for (let i = 0; i < HOLES_PER_ROUND; i++) state = shoot(state, 0, 0.3);
    expect(total(state)).toBe(HOLES_PER_ROUND);
    expect(score(state)).toEqual({
      value: HOLES_PER_ROUND,
      detail: { key: "chart.under", values: { count: HOLES_PER_ROUND } },
    });

    const level = { ...state, cards: state.cards.map(() => 2) };
    expect(score(level)).toEqual({ value: 2 * HOLES_PER_ROUND, detail: { key: "chart.even" } });
    const over = { ...state, cards: [3, 2, 2, 2, 2, 4] };
    expect(score(over).detail).toEqual({ key: "chart.over", values: { count: 3 } });
  });

  test(`counts ${HOLE_CAP} for every hole a round ended early never finished`, () => {
    const state = init(11);
    expect(score(state)).toEqual({
      value: HOLES_PER_ROUND * HOLE_CAP,
      detail: { key: "chart.ended", values: { count: 0 } },
    });
    const partway = { ...state, hole: 2, cards: [2, 3], strokes: 4 };
    expect(score(partway)).toEqual({
      value: 5 + (HOLES_PER_ROUND - 2) * HOLE_CAP,
      detail: { key: "chart.ended", values: { count: 2 } },
    });
  });

  test("ranks the fewest strokes first", () => {
    expect(minigolfGame.meta).toEqual({ name: "Mini Golf", order: "asc", format: "number" });
  });
});

describe("the view", () => {
  test("shows the whole course, the round's par and whether it is over", () => {
    const state = init(5);
    const shown = view(state);
    expect(shown.course).toEqual(state.course);
    expect(shown.par).toBe(parOf(state.course));
    expect(shown.over).toBe(false);
    expect(shown.ball).toEqual(state.course[0].tee);
  });
});
