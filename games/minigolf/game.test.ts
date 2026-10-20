import { describe, expect, test } from "vitest";

import { nextInt } from "../../shared/prng";
import {
  BALL_R,
  COURSE,
  FIELD_H,
  FIELD_W,
  HOLES_PER_ROUND,
  MIN_POWER,
  MinigolfActionSchema,
  OVER_PAR,
  STRAY_ANGLE,
  STRAY_POWER,
  TUNNEL_R,
  capOf,
  fits,
  init,
  inside,
  isOver,
  layOut,
  limitOf,
  minigolfGame,
  mirror,
  parOf,
  reduce,
  roll,
  score,
  total,
  traceOf,
  view,
} from "./game";
import type { Hole, MinigolfState, Point } from "./game";

type Shot = [angle: number, power: number];

// A way to play every hole of the course in par, as drawn and mirrored, found
// by searching over angle and power. Played exactly as aimed, with no stray,
// the rolls are deterministic, so each of these holes out exactly the same way
// every time; a change to the physics or to a hole that breaks one has made
// that hole harder than its par says.
const IN_PAR: [plain: Shot[], mirrored: Shot[]][] = [
  [
    [
      [320, 0.911],
      [136, 0.883],
      [92, 0.985],
    ],
    [
      [40, 0.911],
      [224, 0.883],
      [92, 0.959],
    ],
  ],
  [
    [
      [60, 1],
      [223, 1],
      [28, 0.686],
    ],
    [
      [300, 1],
      [137, 1],
      [78, 0.975],
    ],
  ],
  [
    [
      [52, 1],
      [0, 0.374],
    ],
    [
      [308, 1],
      [0, 0.374],
    ],
  ],
  [
    [
      [323, 0.959],
      [32, 0.812],
    ],
    [
      [37, 0.959],
      [278, 0.812],
    ],
  ],
  [
    [
      [165, 0.922],
      [219, 1],
      [31, 0.806],
    ],
    [
      [195, 0.922],
      [141, 1],
      [92, 1],
    ],
  ],
  [
    [
      [306, 0.866],
      [305, 0.283],
    ],
    [
      [54, 0.866],
      [29, 0.283],
    ],
  ],
  [
    [
      [7, 1],
      [130, 1],
      [168, 1],
      [0, 0.583],
    ],
    [
      [353, 1],
      [230, 1],
      [192, 1],
      [0, 0.583],
    ],
  ],
  [
    [
      [77, 1],
      [292, 1],
      [131, 1],
      [211, 0.889],
    ],
    [
      [283, 1],
      [68, 1],
      [229, 1],
      [29, 0.954],
    ],
  ],
  [
    [
      [46, 0.872],
      [159, 1],
      [11, 0.8],
    ],
    [
      [46, 0.872],
      [201, 1],
      [5, 0.794],
    ],
  ],
  [
    [
      [248, 1],
      [332, 1],
      [37, 0.98],
    ],
    [
      [112, 1],
      [28, 1],
      [314, 1],
    ],
  ],
  [
    [
      [50, 1],
      [0, 0.49],
    ],
    [
      [310, 1],
      [0, 0.49],
    ],
  ],
  [
    [
      [171, 1],
      [45, 0.51],
      [0, 0.964],
    ],
    [
      [189, 1],
      [315, 0.51],
      [0, 0.964],
    ],
  ],
  [
    [
      [44, 1],
      [233, 1],
      [16, 1],
    ],
    [
      [316, 1],
      [127, 1],
      [196, 0.964],
    ],
  ],
  [
    [
      [245, 1],
      [113, 0.906],
      [310, 0.949],
    ],
    [
      [115, 1],
      [247, 0.906],
      [44, 0.906],
    ],
  ],
  [
    [
      [20, 1],
      [53, 0.917],
    ],
    [
      [340, 1],
      [188, 0.938],
    ],
  ],
  [
    [
      [334, 0.927],
      [27, 0.894],
    ],
    [
      [26, 0.927],
      [71, 1],
    ],
  ],
  [
    [
      [141, 1],
      [310, 1],
      [8, 0.794],
    ],
    [
      [219, 1],
      [50, 1],
      [128, 0.911],
    ],
  ],
  [
    [
      [6, 0.819],
      [39, 0.964],
    ],
    [
      [354, 0.819],
      [81, 0.854],
    ],
  ],
  [
    [
      [45, 1],
      [5, 1],
      [46, 0.806],
    ],
    [
      [315, 1],
      [355, 1],
      [1, 0.387],
    ],
  ],
  [
    [
      [292, 0.949],
      [74, 0.99],
      [219, 0.721],
    ],
    [
      [68, 0.949],
      [286, 0.99],
      [49, 0.671],
    ],
  ],
  [
    [
      [320, 0.911],
      [39, 1],
    ],
    [
      [40, 0.911],
      [223, 0.889],
    ],
  ],
  [
    [
      [5, 1],
      [127, 1],
      [167, 0.938],
      [21, 1],
      [122, 0.959],
    ],
    [
      [355, 1],
      [233, 1],
      [193, 0.938],
      [339, 1],
      [121, 0.995],
    ],
  ],
  [
    [
      [57, 0.995],
      [20, 0.316],
    ],
    [
      [57, 0.995],
      [20, 0.316],
    ],
  ],
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
    ice: [],
    springs: [],
    tunnels: [],
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

// The state of a run that strays, started at `now`.
function strayingWith(course: Hole[], now: number): MinigolfState {
  return { ...stateWith(course), traces: { hole: 0, shots: [] }, rng: init(1, now).rng };
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
        const tunnels = variant.tunnels ?? [];
        const inMouth = ([x, y]: Point) =>
          tunnels.some(({ from }) => Math.hypot(x - from[0], y - from[1]) < TUNNEL_R + BALL_R);
        expect(inMouth(variant.tee)).toBe(false);
        expect(inMouth(variant.cup)).toBe(false);
        for (const { from, to } of tunnels) {
          // A tunnel's mouth is on open ground, and its exit leaves the ball
          // there, clear of water and of every mouth.
          expect(fits(variant, ...from)).toBe(true);
          expect(fits(variant, ...to)).toBe(true);
          expect(variant.water.some((area) => inside(area, ...to))).toBe(false);
          expect(inMouth(to)).toBe(false);
        }
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

  // Every tee is tried at every few degrees and every few hundredths of power,
  // played exactly as aimed. A finer search, at every half a degree and every
  // half a hundredth, found none either when the course was laid out.
  test.each(COURSE.map((hole, i) => [i, hole] as const))(
    "hole %i cannot be played in one, as drawn or mirrored",
    (_, hole) => {
      for (const variant of [hole, mirror(hole)]) {
        for (let angle = 0; angle < 360; angle += 3) {
          for (let power = MIN_POWER; power <= 1; power += 0.03) {
            expect(roll(variant, variant.tee, angle, power).outcome).not.toBe("holed");
          }
        }
      }
    },
    30_000,
  );

  test("has holes of every par from three to six", () => {
    expect(new Set(COURSE.map(({ par }) => par))).toEqual(new Set([3, 4, 5, 6]));
  });

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
          for (const { at, r } of hole.springs ?? []) {
            expect(Math.hypot(x - at[0], y - at[1])).toBeGreaterThan(r);
          }
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
    expect(roll(hole, hole.tee, 0, 0.4).outcome).toBe("holed");
    expect(roll(hole, hole.tee, 0, 1).outcome).toBe("rest");
  });

  test("ends a holed shot's path in the cup", () => {
    const hole = plainHole({ cup: [50, 96] });
    const rolled = roll(hole, hole.tee, 0, 0.4);
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

  test("slides further on ice", () => {
    const open = plainHole();
    const rink = plainHole({
      ice: [
        [
          [20, 40],
          [80, 40],
          [80, 100],
          [20, 100],
        ],
      ],
    });
    const onGrass = roll(open, open.tee, 0, 0.4).end;
    const onIce = roll(rink, rink.tee, 0, 0.4).end;
    expect(onIce[1]).toBeLessThan(onGrass[1]);
  });

  test("is kicked back off a spring faster than off a wall", () => {
    const hole = plainHole();
    const sprung = plainHole({ springs: [{ at: [50, 80], r: 5 }] });
    const walled = plainHole({
      blocks: [
        [
          [45, 75],
          [55, 75],
          [55, 85],
          [45, 85],
        ],
      ],
    });
    const offSpring = roll(sprung, sprung.tee, 0, 0.5);
    const offWall = roll(walled, walled.tee, 0, 0.5);
    expect(offSpring.end[1]).toBeGreaterThan(offWall.end[1]);
    expect(roll(hole, hole.tee, 0, 0.5).end[1]).toBeLessThan(80);
    expect(fits(sprung, 50, 80 - 5 - BALL_R / 2)).toBe(false);
  });

  test("plays a hole laid out before there was ice, springs or tunnels", () => {
    const {
      ice: _ice,
      springs: _springs,
      tunnels: _tunnels,
      ...before
    } = plainHole({ cup: [50, 96] });
    expect(roll(before, before.tee, 0, 0.4).outcome).toBe("holed");
    expect(mirror(before)).toMatchObject({ ice: [], springs: [], tunnels: [] });
  });

  test("carries a ball through a tunnel, rolling on the way it went in", () => {
    const hole = plainHole({ tunnels: [{ from: [50, 90], to: [30, 40] }] });
    const rolled = roll(hole, hole.tee, 0, 0.5);
    expect(rolled.jumps).toHaveLength(1);
    const [jump] = rolled.jumps;
    expect(pointsOf(rolled.path)[jump - 1]).toEqual([50, 90]);
    expect(pointsOf(rolled.path)[jump]).toEqual([30, 40]);
    // Still heading up the screen, from the exit.
    expect(rolled.end[0]).toBeCloseTo(30, 5);
    expect(rolled.end[1]).toBeLessThan(40);
  });

  test("passes a ball by a tunnel it misses", () => {
    const hole = plainHole({ tunnels: [{ from: [70, 90], to: [30, 40] }] });
    expect(roll(hole, hole.tee, 0, 0.5).jumps).toEqual([]);
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
    const state = shoot(stateWith([first, second]), 0, 0.4);
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

  test.each([3, 4, 5, 6])(
    `picks the ball up ${OVER_PAR} over a par of %i, and the hole scores one more`,
    (par) => {
      const hole = plainHole({ par });
      expect(limitOf(hole)).toBe(par + OVER_PAR);
      expect(capOf(hole)).toBe(par + OVER_PAR + 1);
      let state = stateWith([hole, hole]);
      for (let stroke = 1; stroke < limitOf(hole); stroke++) {
        state = shoot(state, 90, MIN_POWER);
        expect(state.hole).toBe(0);
      }
      state = shoot(state, 90, MIN_POWER);
      expect(state.cards).toEqual([capOf(hole)]);
      expect(state.hole).toBe(1);
      expect(state.last).toMatchObject({
        outcome: "rest",
        strokes: limitOf(hole),
        card: capOf(hole),
      });
    },
  );

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
    for (let stroke = 1; stroke < limitOf(hole); stroke++) state = shoot(state, 90, MIN_POWER);
    state = shoot(state, 0, 0.8);
    expect(state.cards).toEqual([capOf(hole)]);
    expect(state.last).toMatchObject({ outcome: "water", strokes: limitOf(hole) + 1 });
  });

  test("plays a shot sent twice only once", () => {
    const hole = plainHole();
    const state = stateWith([hole, hole]);
    const once = reduce(state, { t: "shot", n: 0, angle: 0, power: 0.3 });
    expect(reduce(once, { t: "shot", n: 0, angle: 0, power: 0.3 })).toBe(once);
  });

  test("keeps a trace of each shot on the hole, until the next hole's first", () => {
    const first = plainHole({ cup: [50, 96] });
    const second = plainHole();
    let state = shoot(stateWith([first, second]), 180, MIN_POWER);
    expect(state.traces?.hole).toBe(0);
    expect(state.traces?.shots).toHaveLength(1);
    // Holed: the finished hole keeps its traces while it is on screen.
    state = shoot(state, 0, 0.42);
    expect(state.hole).toBe(1);
    expect(state.traces).toMatchObject({ hole: 0 });
    expect(state.traces?.shots).toHaveLength(2);
    state = shoot(state, 0, 0.3);
    expect(state.traces?.hole).toBe(1);
    expect(state.traces?.shots).toHaveLength(1);
  });

  test("traces a shot as one line per stretch between tunnels, thinned out", () => {
    const path = Array.from({ length: 20 }, (_, i) => [i, 100 - i]).flat();
    const [whole] = traceOf(path);
    expect(pointsOf(whole)[0]).toEqual([0, 100]);
    expect(pointsOf(whole).at(-1)).toEqual([19, 81]);
    expect(whole.length).toBeLessThan(path.length / 2);
    const split = traceOf(path, [8]);
    expect(split).toHaveLength(2);
    expect(pointsOf(split[0]).at(-1)).toEqual([7, 93]);
    expect(pointsOf(split[1])[0]).toEqual([8, 92]);
  });

  test("ends the round on the last hole, and takes no more shots", () => {
    const hole = plainHole({ cup: [50, 96] });
    let state = stateWith(Array.from({ length: HOLES_PER_ROUND }, () => hole));
    for (let i = 0; i < HOLES_PER_ROUND; i++) state = shoot(state, 0, 0.4);
    expect(isOver(state)).toBe(true);
    expect(state.cards).toEqual(Array.from({ length: HOLES_PER_ROUND }, () => 1));
    expect(() => shoot(state, 0, 0.4)).toThrow();
  });
});

describe("a shot's stray", () => {
  // A plain hole with nothing in the way of a shot straight up it.
  const open = plainHole({ cup: [50, 12] });

  test("turns a shot by no more than its limit, and changes its power by no more", () => {
    // How far the ball has gone a sixth of a second in, played exactly as
    // aimed, which is far enough to measure and not yet near a wall.
    const at = (path: number[]) => [path[0], path[1], path[20], path[21]];
    const [ex0, ey0, ex1, ey1] = at(roll(open, open.tee, 0, 0.5).path);
    const exactRun = Math.hypot(ex1 - ex0, ey1 - ey0);
    let turned = 0;
    for (let now = 0; now < 200; now++) {
      const state = shoot(strayingWith([open, open], now), 0, 0.5);
      const [x0, y0, x1, y1] = at(state.last!.path);
      const angle = (Math.atan2(x1 - x0, y0 - y1) * 180) / Math.PI;
      // The path is rounded to hundredths, which blurs its angle a little.
      expect(Math.abs(angle)).toBeLessThanOrEqual(STRAY_ANGLE + 0.1);
      const run = Math.hypot(x1 - x0, y1 - y0);
      // Friction takes the same off every shot, so the run varies a little more than the power.
      expect(Math.abs(run / exactRun - 1)).toBeLessThanOrEqual(STRAY_POWER * 1.2);
      if (Math.abs(angle) > 0.1) turned++;
    }
    // And it does stray, most of the time.
    expect(turned).toBeGreaterThan(120);
  });

  test("is different for runs started at different moments, on the same day", () => {
    const ends = new Set(
      Array.from({ length: 20 }, (_, now) =>
        JSON.stringify(shoot(strayingWith([open, open], now * 1000), 30, 0.6).ball),
      ),
    );
    expect(ends.size).toBe(20);
  });

  test("is the same for the same run, so a run replays the same", () => {
    const a = shoot(strayingWith([open, open], 42), 30, 0.6);
    const b = shoot(strayingWith([open, open], 42), 30, 0.6);
    expect(a).toEqual(b);
    expect(a.rng).not.toBe(strayingWith([open, open], 42).rng);
  });

  test("is drawn from a state the view never shows", () => {
    const state = init(9, 1_700_000_000_000);
    expect(state.rng).toEqual(expect.any(Number));
    expect(view(state)).not.toHaveProperty("rng");
    expect(JSON.stringify(view(state))).not.toContain(String(state.rng));
  });

  test("leaves a run from before shots strayed playing them exactly as aimed", () => {
    const state = shoot(stateWith([open, open]), 30, 0.6);
    expect(state.ball).toEqual(roll(open, open.tee, 30, 0.6).end);
    expect(state).not.toHaveProperty("rng");
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
    for (let i = 0; i < HOLES_PER_ROUND; i++) state = shoot(state, 0, 0.4);
    expect(total(state)).toBe(HOLES_PER_ROUND);
    expect(score(state)).toEqual({
      value: HOLES_PER_ROUND,
      detail: { key: "chart.under", values: { count: HOLES_PER_ROUND, cards: "1 1 1 1 1 1" } },
    });

    const level = { ...state, cards: state.cards.map(() => 2) };
    expect(score(level)).toEqual({
      value: 2 * HOLES_PER_ROUND,
      detail: { key: "chart.even", values: { cards: "2 2 2 2 2 2" } },
    });
    const over = { ...state, cards: [3, 2, 2, 2, 2, 4] };
    expect(score(over).detail).toEqual({
      key: "chart.over",
      values: { count: 3, cards: "3 2 2 2 2 4" },
    });
  });

  test("counts every hole a round ended early never finished as picked up", () => {
    const state = init(11);
    const caps = state.course.map(capOf);
    const sum = (cards: number[]) => cards.reduce((a, b) => a + b, 0);
    expect(score(state)).toEqual({
      value: sum(caps),
      detail: { key: "chart.ended", values: { count: 0, cards: "" } },
    });
    const partway = { ...state, hole: 2, cards: [2, 3], strokes: 4 };
    expect(score(partway)).toEqual({
      value: 5 + sum(caps.slice(2)),
      detail: { key: "chart.ended", values: { count: 2, cards: "2 3" } },
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
