import { z } from "zod";

import { nextInt, shuffle } from "../../shared/prng";
import type { DailyGameModule, DailyScore } from "../../shared/game";

// Mini golf, as a daily game: a round of six holes, drawn from the course
// below for the day and the same for every player. A shot is a direction and
// a power; the ball rolls, bounces off walls, slows in sand, is pulled down
// slopes, and drops if it reaches the cup slowly enough. A ball that rolls
// into water costs a penalty stroke and goes back to where it was hit from.
//
// Five strokes a hole, penalties included: a ball still out after the fifth
// is picked up, and the hole scores six. The chart ranks rounds by their
// total, fewest first. A round ended early, by its player or by midnight,
// scores six for every hole it did not finish, so it still ranks, behind
// any round that played those holes out.
//
// The server alone rolls the ball. Floating-point trigonometry is not
// promised to give the same bits in every JavaScript engine, so a page that
// rolled its own copy could see a ball stop somewhere the server's did not.
// Instead each shot's path is recorded as the server rolled it, and the page
// plays that back. Nothing here is secret: the course is laid out in plain
// view, and nothing is drawn at random after it is.

// The playing field every hole is drawn inside, in course units. A hole's
// walls keep a few units clear of its edge, where the page draws them.
export const FIELD_W = 100;
export const FIELD_H = 130;

export const HOLES_PER_ROUND = 6;
// Strokes a hole allows, penalties included, before the ball is picked up.
export const MAX_STROKES = 5;
// What a hole scores when the ball is picked up, and what a hole the round
// never finished scores.
export const HOLE_CAP = 6;
export const WATER_PENALTY = 1;

export const BALL_R = 1.6;
export const CUP_R = 2.6;
// The slowest and fastest a shot leaves the tee, as a fraction of full power.
export const MIN_POWER = 0.05;

// Speeds are in units per second and forces in units per second squared.
const MAX_SPEED = 150;
// How fast rolling slows the ball on the green, and in sand.
const FRICTION = 45;
const SAND_FRICTION = 200;
// A slope's pull. Stronger than the green's friction, so a ball never comes
// to rest on one: it rolls off it, downhill.
const SLOPE_PULL = 75;
// The share of its speed into a wall that a ball keeps when it bounces.
const BOUNCE = 0.7;
// A ball rolling over the cup faster than this rattles across it.
const CAPTURE_SPEED = 40;
// A ball this slow that touches a wall stays against it: a slope pushing it
// into the wall would otherwise bounce it there forever.
const STICK_SPEED = 3;
// No ball ever travels further in one step than half its radius, which is
// what keeps it from passing through a wall. A slope can speed a ball up
// past a full-power shot, so this is a cap of its own, above that.
const SPEED_LIMIT = 190;
const STEP = 1 / 240;
// The path keeps one point in every few steps, 60 a second.
export const SAMPLE_EVERY = 4;
export const SAMPLE_MS = STEP * SAMPLE_EVERY * 1000;
// A ball still moving after this long is left where it is.
const MAX_STEPS = 12 * 240;

export type Point = [x: number, y: number];
export type Area = Point[];

export interface Slope {
  area: Area;
  // Downhill, as a unit vector.
  fall: Point;
}

export interface Hole {
  par: number;
  // The course's outline, walled all the way round.
  edge: Area;
  // Solid obstacles inside it.
  blocks: Area[];
  sand: Area[];
  water: Area[];
  slopes: Slope[];
  tee: Point;
  cup: Point;
}

function rect(x0: number, y0: number, x1: number, y1: number): Area {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

function diamond(cx: number, cy: number, r: number): Area {
  return [
    [cx, cy - r],
    [cx + r, cy],
    [cx, cy + r],
    [cx - r, cy],
  ];
}

const DOWN: Point = [0, 1];
const LEFT: Point = [-1, 0];
const RIGHT: Point = [1, 0];

function hole(parts: Partial<Hole> & Pick<Hole, "par" | "edge" | "tee" | "cup">): Hole {
  return { blocks: [], sand: [], water: [], slopes: [], ...parts };
}

// The course. A round plays six of these, each one either as drawn or
// mirrored left to right. Every one of them can be played in par; the tests
// hold a way to do it for each.
export const COURSE: readonly Hole[] = [
  // A diamond in the way of the straight putt.
  hole({
    par: 2,
    edge: rect(22, 8, 78, 122),
    blocks: [diamond(50, 66, 8)],
    tee: [50, 110],
    cup: [50, 22],
  }),
  // A dogleg: up the left arm, then right along the top.
  hole({
    par: 3,
    edge: [
      [12, 122],
      [44, 122],
      [44, 48],
      [88, 48],
      [88, 8],
      [12, 8],
    ],
    tee: [28, 110],
    cup: [74, 28],
  }),
  // A wall across the middle with a gap at one end.
  hole({
    par: 2,
    edge: rect(14, 8, 86, 122),
    blocks: [rect(14, 62, 58, 70), rect(72, 62, 86, 70)],
    tee: [28, 110],
    cup: [30, 24],
  }),
  // A bunker guarding the cup, with a narrow way round it on one side.
  hole({
    par: 3,
    edge: rect(18, 8, 82, 122),
    sand: [rect(18, 36, 68, 56)],
    tee: [56, 110],
    cup: [36, 24],
  }),
  // A pond between the tee and the cup: round it on the right.
  hole({
    par: 3,
    edge: rect(12, 8, 88, 122),
    water: [rect(12, 56, 64, 78)],
    tee: [32, 110],
    cup: [32, 24],
  }),
  // Two walls, a gap at each end.
  hole({
    par: 3,
    edge: rect(12, 8, 88, 122),
    blocks: [rect(12, 80, 62, 87), rect(38, 43, 88, 50)],
    tee: [28, 112],
    cup: [66, 22],
  }),
  // A bank to climb on the way to the cup: too soft and it rolls back down.
  hole({
    par: 2,
    edge: rect(26, 8, 74, 122),
    slopes: [{ area: rect(26, 50, 74, 78), fall: DOWN }],
    tee: [36, 110],
    cup: [60, 22],
  }),
  // A valley: both sides fall away into a channel up the middle.
  hole({
    par: 2,
    edge: rect(16, 8, 84, 122),
    slopes: [
      { area: rect(16, 28, 44, 104), fall: RIGHT },
      { area: rect(56, 28, 84, 104), fall: LEFT },
    ],
    tee: [30, 112],
    cup: [50, 20],
  }),
  // A hairpin: up one side, across the top, and back down the other.
  hole({
    par: 3,
    edge: [
      [10, 122],
      [42, 122],
      [42, 46],
      [58, 46],
      [58, 122],
      [90, 122],
      [90, 8],
      [10, 8],
    ],
    tee: [26, 110],
    cup: [74, 108],
  }),
  // A field of bumpers.
  hole({
    par: 3,
    edge: rect(14, 8, 86, 122),
    blocks: [
      diamond(34, 50, 6),
      diamond(66, 50, 6),
      diamond(50, 74, 6),
      diamond(30, 94, 6),
      diamond(70, 94, 6),
    ],
    tee: [50, 112],
    cup: [50, 22],
  }),
  // Water across the middle, and a narrow causeway over it.
  hole({
    par: 3,
    edge: rect(14, 8, 86, 122),
    water: [rect(14, 54, 45, 66), rect(55, 54, 86, 66)],
    tee: [28, 112],
    cup: [60, 24],
  }),
  // A funnel, narrowing to the cup, with a bumper in the way.
  hole({
    par: 2,
    edge: [
      [10, 122],
      [90, 122],
      [62, 14],
      [38, 14],
    ],
    blocks: [diamond(38, 68, 5)],
    tee: [24, 112],
    cup: [50, 26],
  }),
  // A chicane: two lanes joined corner to corner, with a bumper where they meet.
  hole({
    par: 3,
    edge: [
      [10, 122],
      [56, 122],
      [56, 88],
      [90, 88],
      [90, 8],
      [44, 8],
      [44, 42],
      [10, 42],
    ],
    blocks: [diamond(50, 65, 7)],
    tee: [24, 110],
    cup: [76, 22],
  }),
  // A sidehill: the middle of the hole falls away to the left.
  hole({
    par: 3,
    edge: rect(14, 8, 86, 122),
    slopes: [{ area: rect(26, 40, 86, 90), fall: LEFT }],
    tee: [30, 112],
    cup: [74, 24],
  }),
  // The cup sits in a bunker, behind a bumper.
  hole({
    par: 3,
    edge: rect(16, 8, 84, 122),
    blocks: [diamond(50, 66, 7)],
    sand: [rect(36, 18, 64, 44)],
    tee: [50, 112],
    cup: [50, 30],
  }),
  // Two ponds to get past, one on each side.
  hole({
    par: 3,
    edge: rect(14, 8, 86, 122),
    water: [rect(14, 76, 58, 90), rect(42, 40, 86, 54)],
    tee: [72, 112],
    cup: [30, 22],
  }),
  // An hourglass, pinched in the middle, with the cup straight above the tee.
  hole({
    par: 2,
    edge: [
      [18, 122],
      [82, 122],
      [58, 65],
      [82, 8],
      [18, 8],
      [42, 65],
    ],
    tee: [30, 112],
    cup: [32, 20],
  }),
  // A climb to the cup, then round the wall in front of it.
  hole({
    par: 3,
    edge: rect(20, 8, 80, 122),
    blocks: [rect(40, 30, 60, 35)],
    slopes: [{ area: rect(20, 42, 80, 58), fall: DOWN }],
    tee: [50, 112],
    cup: [50, 20],
  }),
];

// `hole` with left and right swapped.
export function mirror(hole: Hole): Hole {
  const flip = ([x, y]: Point): Point => [FIELD_W - x, y];
  const area = (points: Area): Area => points.map(flip);
  return {
    par: hole.par,
    edge: area(hole.edge),
    blocks: hole.blocks.map(area),
    sand: hole.sand.map(area),
    water: hole.water.map(area),
    slopes: hole.slopes.map(({ area: points, fall: [x, y] }) => ({
      area: area(points),
      fall: [x === 0 ? 0 : -x, y],
    })),
    tee: flip(hole.tee),
    cup: flip(hole.cup),
  };
}

// The day's round, from its seed: six holes of the course in an order, each
// one mirrored or not.
export function layOut(seed: number): Hole[] {
  const [order, afterOrder] = shuffle(
    COURSE.map((_, i) => i),
    seed,
  );
  let rng = afterOrder;
  return order.slice(0, HOLES_PER_ROUND).map((i) => {
    const [flip, next] = nextInt(rng, 2);
    rng = next;
    return flip === 1 ? mirror(COURSE[i]) : COURSE[i];
  });
}

export function inside(area: Area, x: number, y: number): boolean {
  let within = false;
  for (let i = 0, j = area.length - 1; i < area.length; j = i++) {
    const [xi, yi] = area[i];
    const [xj, yj] = area[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) within = !within;
  }
  return within;
}

// Every wall on `hole` as a segment, x0 y0 x1 y1.
function wallsOf(hole: Hole): number[][] {
  const walls: number[][] = [];
  for (const area of [hole.edge, ...hole.blocks]) {
    for (let i = 0; i < area.length; i++) {
      const [x0, y0] = area[i];
      const [x1, y1] = area[(i + 1) % area.length];
      walls.push([x0, y0, x1, y1]);
    }
  }
  return walls;
}

// Whether a ball could sit at `x, y`: on the course, clear of every wall.
export function fits(hole: Hole, x: number, y: number): boolean {
  if (!inside(hole.edge, x, y) || hole.blocks.some((block) => inside(block, x, y))) return false;
  return wallsOf(hole).every(([x0, y0, x1, y1]) => {
    const [cx, cy] = closest(x, y, x0, y0, x1, y1);
    return (x - cx) ** 2 + (y - cy) ** 2 >= BALL_R ** 2 - 1e-9;
  });
}

function closest(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): [x: number, y: number] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy)));
  return [x0 + t * dx, y0 + t * dy];
}

export type Outcome = "rest" | "holed" | "water";

export interface Roll {
  // The ball's path, sampled every SAMPLE_MS: x0, y0, x1, y1, …, ending
  // where it stopped, dropped or splashed.
  path: number[];
  outcome: Outcome;
  end: Point;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Rolls a ball hit from `from` towards `angle` (degrees clockwise from
// straight up the screen) at `power` (a fraction of full power).
export function roll(hole: Hole, from: Point, angle: number, power: number): Roll {
  const walls = wallsOf(hole);
  const [cupX, cupY] = hole.cup;
  const speed = MAX_SPEED * power;
  const radians = (angle * Math.PI) / 180;
  let x = from[0];
  let y = from[1];
  let vx = Math.sin(radians) * speed;
  let vy = -Math.cos(radians) * speed;
  const path = [round2(x), round2(y)];
  let outcome: Outcome = "rest";

  for (let step = 1; step <= MAX_STEPS; step++) {
    let sloped = false;
    for (const { area, fall } of hole.slopes) {
      if (inside(area, x, y)) {
        vx += fall[0] * SLOPE_PULL * STEP;
        vy += fall[1] * SLOPE_PULL * STEP;
        sloped = true;
      }
    }
    const drag = (hole.sand.some((area) => inside(area, x, y)) ? SAND_FRICTION : FRICTION) * STEP;
    let v = Math.sqrt(vx * vx + vy * vy);
    if (v <= drag) {
      // Flat ground holds a ball this slow. A slope does not: at the top of
      // its climb the ball stops for an instant, and then rolls back down.
      if (!sloped) break;
      vx = 0;
      vy = 0;
    } else {
      const keep = Math.min(v - drag, SPEED_LIMIT) / v;
      vx *= keep;
      vy *= keep;
    }

    x += vx * STEP;
    y += vy * STEP;

    let touched = false;
    for (const [x0, y0, x1, y1] of walls) {
      const [cx, cy] = closest(x, y, x0, y0, x1, y1);
      let nx = x - cx;
      let ny = y - cy;
      const d = Math.sqrt(nx * nx + ny * ny);
      if (d >= BALL_R) continue;
      if (d > 1e-9) {
        nx /= d;
        ny /= d;
      } else {
        // Dead on the wall's line: push out along its normal.
        const len = Math.hypot(x1 - x0, y1 - y0);
        nx = -(y1 - y0) / len;
        ny = (x1 - x0) / len;
      }
      x = cx + nx * BALL_R;
      y = cy + ny * BALL_R;
      const into = vx * nx + vy * ny;
      if (into < 0) {
        vx -= (1 + BOUNCE) * into * nx;
        vy -= (1 + BOUNCE) * into * ny;
      }
      touched = true;
    }
    v = Math.sqrt(vx * vx + vy * vy);
    if (touched && v < STICK_SPEED) break;

    if ((x - cupX) ** 2 + (y - cupY) ** 2 < CUP_R ** 2 && v < CAPTURE_SPEED) {
      outcome = "holed";
      x = cupX;
      y = cupY;
      break;
    }
    if (hole.water.some((area) => inside(area, x, y))) {
      outcome = "water";
      break;
    }
    if (step % SAMPLE_EVERY === 0) path.push(round2(x), round2(y));
  }

  const endX = round2(x);
  const endY = round2(y);
  if (path[path.length - 2] !== endX || path[path.length - 1] !== endY) path.push(endX, endY);
  return { path, outcome, end: [x, y] };
}

export interface LastShot {
  // The hole it was played on, as an index into the round.
  hole: number;
  from: Point;
  path: number[];
  outcome: Outcome;
  // The hole's strokes after it, its penalty included.
  strokes: number;
  // What the hole scored, when this shot ended it: holed, or picked up.
  card: number | null;
}

export interface MinigolfState {
  course: Hole[];
  // The hole being played, as an index into `course`; the course's length
  // once the round is done.
  hole: number;
  ball: Point;
  // Strokes on the hole being played so far, penalties included.
  strokes: number;
  // What each finished hole scored, in order.
  cards: number[];
  // Every shot of the round, counted. A shot names the count it was aimed
  // at, so one sent twice is only played once.
  shots: number;
  last: LastShot | null;
}

export type MinigolfAction = { t: "shot"; n: number; angle: number; power: number };

export const MinigolfActionSchema: z.ZodType<MinigolfAction> = z.object({
  t: z.literal("shot"),
  n: z.number().int().min(0),
  angle: z.number().min(0).max(360),
  power: z.number().min(MIN_POWER).max(1),
});

export function isOver(state: MinigolfState): boolean {
  return state.hole >= state.course.length;
}

export function init(seed: number): MinigolfState {
  const course = layOut(seed);
  return {
    course,
    hole: 0,
    ball: course[0].tee,
    strokes: 0,
    cards: [],
    shots: 0,
    last: null,
  };
}

// A shot aimed at a ball that has already been hit again is dropped rather
// than refused: a Shoot pressed twice before the first reply came back
// would otherwise play the second from wherever the first one stopped.
export function reduce(state: MinigolfState, action: MinigolfAction): MinigolfState {
  if (isOver(state)) throw new Error("the round is over");
  if (action.n !== state.shots) return state;
  const played = state.course[state.hole];
  const shot = roll(played, state.ball, action.angle, action.power);
  const strokes = state.strokes + 1 + (shot.outcome === "water" ? WATER_PENALTY : 0);
  const card = shot.outcome === "holed" ? strokes : strokes >= MAX_STROKES ? HOLE_CAP : null;
  const last: LastShot = {
    hole: state.hole,
    from: state.ball,
    path: shot.path,
    outcome: shot.outcome,
    strokes,
    card,
  };
  if (card === null) {
    return {
      ...state,
      ball: shot.outcome === "water" ? state.ball : shot.end,
      strokes,
      shots: state.shots + 1,
      last,
    };
  }
  const next = state.hole + 1;
  return {
    ...state,
    hole: next,
    ball: next < state.course.length ? state.course[next].tee : shot.end,
    strokes: 0,
    cards: [...state.cards, card],
    shots: state.shots + 1,
    last,
  };
}

export type MinigolfView = MinigolfState & { par: number; over: boolean };

export function view(state: MinigolfState): MinigolfView {
  return { ...state, par: parOf(state.course), over: isOver(state) };
}

export function parOf(course: readonly Hole[]): number {
  return course.reduce((sum, { par }) => sum + par, 0);
}

// The round's total: every finished hole's card, and the cap for each one
// it never finished.
export function total(state: MinigolfState): number {
  const played = state.cards.reduce((sum, card) => sum + card, 0);
  return played + (state.course.length - state.cards.length) * HOLE_CAP;
}

export function score(state: MinigolfState): DailyScore {
  const value = total(state);
  if (!isOver(state)) {
    return { value, detail: { key: "chart.ended", values: { count: state.cards.length } } };
  }
  const toPar = value - parOf(state.course);
  const detail =
    toPar === 0
      ? { key: "chart.even" }
      : toPar < 0
        ? { key: "chart.under", values: { count: -toPar } }
        : { key: "chart.over", values: { count: toPar } };
  return { value, detail };
}

export const minigolfGame: DailyGameModule<MinigolfState, MinigolfAction> = {
  id: "minigolf",
  meta: { name: "Mini Golf", order: "asc", format: "number" },
  actionSchema: MinigolfActionSchema,
  init,
  reduce,
  view,
  finished: isOver,
  score,
};
