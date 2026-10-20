import { z } from "zod";

import { nextInt, nextUint32, shuffle } from "../../shared/prng";
import type { ActionDescription, DailyGameModule, DailyScore } from "../../shared/game";

// Mini golf, as a daily game: a round of six holes, drawn from the course
// below for the day and the same for every player. A shot is a direction and
// a power; the ball rolls, bounces off walls, slows in sand, slides on ice,
// is pulled down slopes, is kicked away by springs, drops into a tunnel and
// comes out of its other end, and drops into the cup if it reaches it slowly
// enough. A ball that rolls into water costs a penalty stroke and goes back
// to where it was hit from.
//
// A hole allows three strokes over its par, penalties included: a ball still
// out after that is picked up, and the hole scores four over par. The chart
// ranks rounds by their total, fewest first. A round ended early, by its
// player or by midnight, scores four over par for every hole it did not
// finish, so it still ranks, behind any round that played those holes out.
//
// The server alone rolls the ball. Floating-point trigonometry is not
// promised to give the same bits in every JavaScript engine, so a page that
// rolled its own copy could see a ball stop somewhere the server's did not.
// Instead each shot's path is recorded as the server rolled it, and the page
// plays that back.
//
// The course is laid out in plain view, but no shot goes exactly where it
// was aimed: each one strays by a hair, in angle and in power, drawn from a
// PRNG seeded with the day's seed and the moment the run started. Without
// that, every shot would be repeatable to the bit, and a hole in one found
// once, on a practice board or by running this file, would be a hole in one
// every time the hole came round. The PRNG's state must never reach
// `view()`, or a page could aim to cancel the stray out.

// The playing field every hole is drawn inside, in course units. A hole's
// walls keep a few units clear of its edge, where the page draws them.
export const FIELD_W = 100;
export const FIELD_H = 130;

export const HOLES_PER_ROUND = 6;
// Strokes over par a hole allows, penalties included, before the ball is
// picked up.
export const OVER_PAR = 3;
export const WATER_PENALTY = 1;

export const BALL_R = 1.6;
export const CUP_R = 2.6;
// The slowest and fastest a shot leaves the tee, as a fraction of full power.
export const MIN_POWER = 0.05;
// How far a shot can stray either way: degrees of aim, and a fraction of its
// power.
export const STRAY_ANGLE = 0.5;
export const STRAY_POWER = 0.01;
// A tunnel mouth's radius. A ball whose centre crosses into one drops in.
export const TUNNEL_R = 2.8;

// Speeds are in units per second and forces in units per second squared.
const MAX_SPEED = 110;
// How fast rolling slows the ball on the green, and in sand.
const FRICTION = 45;
const SAND_FRICTION = 200;
// Ice barely slows the ball at all, so a shot onto it has to be soft.
const ICE_FRICTION = 12;
// A slope's pull. Stronger than the green's friction, so a ball never comes
// to rest on one: it rolls off it, downhill.
const SLOPE_PULL = 75;
// The share of its speed into a wall that a ball keeps when it bounces.
const BOUNCE = 0.7;
// What a spring gives back instead: more than the ball brought into it. A
// wall takes more than a spring adds, so a ball caught between the two
// still slows down.
const SPRING_BOUNCE = 1.25;
// A ball rolling over the cup faster than this rattles across it.
const CAPTURE_SPEED = 40;
// A ball this slow that touches a wall stays against it: a slope pushing it
// into the wall would otherwise bounce it there forever.
const STICK_SPEED = 3;
// No ball ever travels further in one step than half its radius, which is
// what keeps it from passing through a wall. A slope or a spring can speed a
// ball up past a full-power shot, so this is a cap of its own, above that.
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

// A round, springy bumper: it kicks the ball back off it faster than it came.
export interface Spring {
  at: Point;
  r: number;
}

// A tunnel: a ball that drops into its mouth at `from` comes out at `to`,
// rolling on the way it went in, and as fast. It runs one way only.
export interface Tunnel {
  from: Point;
  to: Point;
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
  // Absent from a round laid out before there was any ice or a spring on the
  // course: a run keeps the course it started with.
  ice?: Area[];
  springs?: Spring[];
  // Absent from a round laid out before there were tunnels.
  tunnels?: Tunnel[];
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
  return {
    blocks: [],
    sand: [],
    water: [],
    slopes: [],
    ice: [],
    springs: [],
    tunnels: [],
    ...parts,
  };
}

function spring(x: number, y: number, r: number): Spring {
  return { at: [x, y], r };
}

// The course. A round plays six of these, each one either as drawn or
// mirrored left to right. Every one of them can be played in par, and none
// in one: the tests hold a way to play each in par, and look for a hole in
// one from every tee.
export const COURSE: readonly Hole[] = [
  // A hairpin: up one side, across the top, and back down the other.
  hole({
    par: 4,
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
  // Two walls, a gap at each end.
  hole({
    par: 4,
    edge: rect(12, 8, 88, 122),
    blocks: [rect(12, 80, 62, 87), rect(38, 43, 88, 50)],
    tee: [28, 112],
    cup: [66, 22],
  }),
  // Two ponds to get past, one on each side.
  hole({
    par: 4,
    edge: rect(14, 8, 86, 122),
    water: [rect(14, 76, 58, 90), rect(42, 40, 86, 54)],
    tee: [72, 112],
    cup: [30, 22],
  }),
  // The cup in a pocket, its one way in round the far side and back over a wall.
  hole({
    par: 3,
    edge: rect(14, 8, 86, 122),
    blocks: [rect(26, 44, 52, 50), rect(46, 8, 52, 44), rect(28, 17, 34, 44)],
    tee: [70, 112],
    cup: [40, 40],
  }),
  // A wall all the way across but for a gap at one end, and a tunnel under it.
  hole({
    par: 4,
    edge: rect(12, 8, 88, 122),
    blocks: [rect(12, 60, 76, 68), rect(26, 30, 88, 36)],
    tunnels: [{ from: [44, 80], to: [44, 50] }],
    tee: [24, 112],
    cup: [70, 20],
  }),
  // An island ringed by water, with the cup on it: the only way there is the tunnel.
  hole({
    par: 3,
    edge: rect(10, 8, 90, 122),
    water: [rect(28, 12, 72, 18), rect(28, 46, 72, 52), rect(28, 18, 34, 46), rect(66, 18, 72, 46)],
    tunnels: [{ from: [20, 64], to: [50, 42] }],
    tee: [70, 112],
    cup: [50, 26],
  }),
  // Switchbacks: up, over, down, under and up again.
  hole({
    par: 5,
    edge: rect(8, 8, 92, 122),
    blocks: [rect(34, 30, 40, 122), rect(60, 8, 66, 100)],
    tee: [21, 112],
    cup: [79, 20],
  }),
  // Four lanes stacked up the course, each turning back on the last.
  hole({
    par: 5,
    edge: rect(8, 8, 92, 122),
    blocks: [rect(8, 34, 72, 40), rect(28, 62, 92, 68), rect(8, 90, 72, 96)],
    tee: [20, 110],
    cup: [20, 21],
  }),
  // Switchbacks again, with a bunker on the top bend and a tunnel to cut a lane.
  hole({
    par: 5,
    edge: rect(8, 8, 92, 122),
    blocks: [rect(34, 26, 40, 122), rect(60, 8, 66, 104)],
    sand: [rect(40, 8, 60, 22)],
    tunnels: [{ from: [21, 50], to: [50, 96] }],
    tee: [21, 112],
    cup: [79, 22],
  }),
  // A spiral: round the outside, in at the corner, and back round the inside.
  hole({
    par: 5,
    edge: rect(8, 8, 92, 122),
    blocks: [
      rect(24, 24, 76, 30),
      rect(70, 30, 76, 106),
      rect(24, 100, 70, 106),
      rect(24, 48, 30, 100),
      rect(30, 48, 56, 54),
    ],
    tee: [84, 114],
    cup: [44, 80],
  }),
  // A slalom on ice, with a bunker round the cup to stop in.
  hole({
    par: 3,
    edge: rect(20, 8, 80, 122),
    ice: [rect(20, 26, 80, 104)],
    blocks: [rect(20, 84, 56, 90), rect(44, 56, 80, 62), rect(20, 30, 56, 36)],
    sand: [rect(56, 8, 80, 26)],
    tee: [30, 114],
    cup: [68, 18],
  }),
  // Down one side and back up the other, against a bank that rolls a soft putt back.
  hole({
    par: 4,
    edge: rect(8, 8, 92, 122),
    blocks: [rect(36, 8, 42, 96)],
    slopes: [{ area: rect(42, 40, 92, 80), fall: DOWN }],
    sand: [rect(70, 104, 92, 122)],
    tee: [22, 20],
    cup: [66, 20],
  }),
  // Springs to get past, a gap at the far end of the wall, and one more in the corner.
  hole({
    par: 4,
    edge: rect(14, 8, 86, 122),
    blocks: [rect(14, 44, 60, 50), rect(28, 24, 86, 28)],
    springs: [spring(32, 76, 5), spring(68, 76, 5), spring(50, 96, 5)],
    tee: [50, 112],
    cup: [72, 16],
  }),
  // The grand tour: five lanes, a pond on the way, and a tunnel to skip one.
  hole({
    par: 5,
    edge: rect(6, 6, 94, 124),
    blocks: [rect(6, 27, 78, 32), rect(22, 51, 94, 56), rect(6, 75, 78, 80), rect(22, 99, 94, 104)],
    water: [rect(36, 56, 52, 64)],
    tunnels: [{ from: [70, 90], to: [70, 42] }],
    tee: [86, 114],
    cup: [14, 16],
  }),
  // A staircase, one step at a time, with a bunker on the middle step.
  hole({
    par: 3,
    edge: [
      [8, 122],
      [34, 122],
      [34, 96],
      [60, 96],
      [60, 70],
      [92, 70],
      [92, 8],
      [66, 8],
      [66, 44],
      [34, 44],
      [34, 70],
      [8, 70],
    ],
    sand: [rect(34, 80, 48, 96)],
    blocks: [diamond(50, 62, 5)],
    tee: [21, 112],
    cup: [79, 20],
  }),
  // A rink: ice from wall to wall, springs on it, and the cup behind a wall.
  hole({
    par: 5,
    edge: rect(16, 8, 84, 122),
    ice: [rect(16, 50, 84, 122)],
    springs: [spring(36, 100, 5), spring(64, 82, 5), spring(36, 64, 5)],
    blocks: [rect(16, 40, 62, 46), rect(30, 22, 84, 26)],
    tee: [50, 114],
    cup: [70, 15],
  }),
  // A wall from side to side, and two tunnels through it that cross.
  hole({
    par: 4,
    edge: rect(12, 8, 88, 122),
    blocks: [rect(12, 62, 88, 68), diamond(50, 36, 6), rect(60, 30, 88, 34)],
    tunnels: [
      { from: [26, 80], to: [30, 50] },
      { from: [74, 80], to: [70, 50] },
    ],
    tee: [50, 112],
    cup: [78, 18],
  }),
  // A narrow slalom between bumpers.
  hole({
    par: 4,
    edge: rect(30, 8, 70, 122),
    blocks: [
      diamond(38, 96, 6),
      diamond(62, 76, 6),
      diamond(38, 56, 6),
      rect(30, 30, 56, 34),
      rect(46, 8, 50, 22),
    ],
    tee: [50, 114],
    cup: [37, 14],
  }),
  // A valley with a pond in its channel: both banks roll the ball down into it.
  hole({
    par: 5,
    edge: rect(8, 8, 92, 122),
    slopes: [
      { area: rect(8, 30, 44, 100), fall: RIGHT },
      { area: rect(56, 30, 92, 100), fall: LEFT },
    ],
    water: [rect(44, 50, 56, 80)],
    blocks: [rect(60, 26, 80, 32), rect(60, 8, 66, 26)],
    sand: [rect(80, 26, 92, 44)],
    tee: [20, 114],
    cup: [73, 16],
  }),
  // Three rooms, joined by doors at opposite ends, and a spring in the middle one.
  hole({
    par: 5,
    edge: rect(8, 8, 92, 122),
    blocks: [rect(8, 44, 70, 50), rect(82, 44, 92, 50), rect(8, 84, 18, 90), rect(30, 84, 92, 90)],
    springs: [spring(50, 66, 6)],
    tee: [80, 112],
    cup: [20, 24],
  }),
  // A hairpin with a bunker on the bend and a long slope down to the cup.
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
    sand: [rect(36, 8, 64, 20)],
    slopes: [{ area: rect(58, 34, 90, 96), fall: DOWN }],
    tee: [26, 110],
    cup: [74, 108],
  }),
  // Four lanes up and down, the third of them iced over.
  hole({
    par: 6,
    edge: rect(6, 8, 94, 122),
    blocks: [rect(24, 30, 30, 122), rect(48, 8, 54, 100), rect(72, 30, 78, 122)],
    ice: [rect(54, 30, 72, 100)],
    tee: [15, 112],
    cup: [86, 112],
  }),
  // A moat round the cup, crossed by a frozen bridge.
  hole({
    par: 4,
    edge: rect(10, 8, 90, 122),
    water: [
      rect(26, 14, 74, 20),
      rect(26, 50, 44, 56),
      rect(56, 50, 74, 56),
      rect(26, 20, 32, 50),
      rect(68, 20, 74, 50),
    ],
    ice: [rect(44, 50, 56, 56)],
    blocks: [diamond(50, 76, 6)],
    tee: [50, 112],
    cup: [50, 32],
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
    ice: (hole.ice ?? []).map(area),
    springs: (hole.springs ?? []).map(({ at, r }) => ({ at: flip(at), r })),
    tunnels: (hole.tunnels ?? []).map(({ from, to }) => ({ from: flip(from), to: flip(to) })),
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
  const clear = (hole.springs ?? []).every(
    ({ at: [sx, sy], r }) => (x - sx) ** 2 + (y - sy) ** 2 >= (r + BALL_R) ** 2 - 1e-9,
  );
  if (!clear) return false;
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
  // The points of `path`, counted in pairs, where the ball came out of a
  // tunnel: the point before each is where it dropped in, and nothing rolls
  // between the two.
  jumps: number[];
  outcome: Outcome;
  end: Point;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Rolls a ball hit from `from` towards `angle` (degrees clockwise from
// straight up the screen) at `power` (a fraction of full power).
export function roll(hole: Hole, from: Point, angle: number, power: number): Roll {
  const walls = wallsOf(hole);
  const ice = hole.ice ?? [];
  const springs = hole.springs ?? [];
  const tunnels = hole.tunnels ?? [];
  const [cupX, cupY] = hole.cup;
  const speed = MAX_SPEED * power;
  const radians = (angle * Math.PI) / 180;
  let x = from[0];
  let y = from[1];
  let vx = Math.sin(radians) * speed;
  let vy = -Math.cos(radians) * speed;
  const path = [round2(x), round2(y)];
  const jumps: number[] = [];
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
    const friction = hole.sand.some((area) => inside(area, x, y))
      ? SAND_FRICTION
      : ice.some((area) => inside(area, x, y))
        ? ICE_FRICTION
        : FRICTION;
    const drag = friction * STEP;
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
    for (const {
      at: [sx, sy],
      r,
    } of springs) {
      let nx = x - sx;
      let ny = y - sy;
      const d = Math.sqrt(nx * nx + ny * ny);
      if (d >= r + BALL_R) continue;
      if (d > 1e-9) {
        nx /= d;
        ny /= d;
      } else {
        nx = 0;
        ny = 1;
      }
      x = sx + nx * (r + BALL_R);
      y = sy + ny * (r + BALL_R);
      const into = vx * nx + vy * ny;
      if (into < 0) {
        vx -= (1 + SPRING_BOUNCE) * into * nx;
        vy -= (1 + SPRING_BOUNCE) * into * ny;
        const kicked = Math.sqrt(vx * vx + vy * vy);
        if (kicked > SPEED_LIMIT) {
          vx *= SPEED_LIMIT / kicked;
          vy *= SPEED_LIMIT / kicked;
        }
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
    const tunnel = tunnels.find(
      ({ from: [tx, ty] }) => (x - tx) ** 2 + (y - ty) ** 2 < TUNNEL_R ** 2,
    );
    if (tunnel) {
      // Recorded twice, either side of the jump, so playback can tell the
      // ball was carried rather than rolled.
      path.push(round2(tunnel.from[0]), round2(tunnel.from[1]));
      [x, y] = tunnel.to;
      jumps.push(path.length / 2);
      path.push(round2(x), round2(y));
      continue;
    }
    if (step % SAMPLE_EVERY === 0) path.push(round2(x), round2(y));
  }

  const endX = round2(x);
  const endY = round2(y);
  if (path[path.length - 2] !== endX || path[path.length - 1] !== endY) path.push(endX, endY);
  return { path, jumps, outcome, end: [x, y] };
}

export interface LastShot {
  // The hole it was played on, as an index into the round.
  hole: number;
  from: Point;
  path: number[];
  // Absent from a shot played before there were tunnels.
  jumps?: number[];
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
  // Where each shot on the last hole played went, the last shot included, as
  // the page draws it faintly behind the ball: a few lines per shot, broken
  // where a tunnel carried the ball, and thinned out, since only their shape
  // matters. Kept past the end of a hole, which stays on screen until its
  // player moves on, and dropped by the next hole's first shot. Absent from a
  // run started before shots left a trace.
  traces?: Traces;
  // The PRNG every shot's stray is drawn from. Absent from a run started
  // before shots strayed, which plays them exactly as aimed. Never shown.
  rng?: number;
}

export interface Traces {
  hole: number;
  shots: number[][][];
}

export type MinigolfAction = { t: "shot"; n: number; angle: number; power: number };

export const MinigolfActionSchema: z.ZodType<MinigolfAction> = z.object({
  t: z.literal("shot"),
  n: z.number().int().min(0),
  angle: z.number().min(0).max(360),
  power: z.number().min(MIN_POWER).max(1),
});

// How many strokes `hole` allows, and what it scores when the ball is picked
// up or the round ends before it is played out.
export const limitOf = (hole: Hole) => hole.par + OVER_PAR;
export const capOf = (hole: Hole) => hole.par + OVER_PAR + 1;

export function isOver(state: MinigolfState): boolean {
  return state.hole >= state.course.length;
}

// The stray's PRNG for a run started at `now` on the day `seed` lays out:
// unguessable without the seed, and different for every run, so no stray one
// player sees says anything about another's.
function strayFrom(seed: number, now: number): number {
  const [low] = nextUint32(seed ^ (now % 0x100000000));
  const [mixed] = nextUint32(low ^ Math.floor(now / 0x100000000));
  return mixed | 0;
}

export function init(seed: number, now = 0): MinigolfState {
  const course = layOut(seed);
  return {
    course,
    hole: 0,
    ball: course[0].tee,
    strokes: 0,
    cards: [],
    shots: 0,
    last: null,
    traces: { hole: 0, shots: [] },
    rng: strayFrom(seed, now),
  };
}

// One of `rng`'s draws as a fraction of the way from -1 to 1.
function signed(rng: number): [value: number, next: number] {
  const [value, next] = nextInt(rng, 2001);
  return [(value - 1000) / 1000, next];
}

// How many samples of a path a trace keeps one of.
const TRACE_EVERY = 3;

// A shot's path as its trace: a line from each jump to the next, keeping one
// point in every few, and always each line's ends.
export function traceOf(path: number[], jumps: readonly number[] = []): number[][] {
  const count = path.length / 2;
  const starts = [0, ...jumps];
  return starts.map((first, i) => {
    const last = (i + 1 < starts.length ? starts[i + 1] : count) - 1;
    const line: number[] = [];
    for (let k = first; k <= last; k++) {
      if (k === first || k === last || (k - first) % TRACE_EVERY === 0) {
        line.push(path[2 * k], path[2 * k + 1]);
      }
    }
    return line;
  });
}

// A shot aimed at a ball that has already been hit again is dropped rather
// than refused: a Shoot pressed twice before the first reply came back
// would otherwise play the second from wherever the first one stopped.
export function reduce(state: MinigolfState, action: MinigolfAction): MinigolfState {
  if (isOver(state)) throw new Error("the round is over");
  if (action.n !== state.shots) return state;
  const played = state.course[state.hole];
  let { angle, power } = action;
  let rng = state.rng;
  if (rng !== undefined) {
    const [turn, afterTurn] = signed(rng);
    const [push, afterPush] = signed(afterTurn);
    rng = afterPush;
    angle = (angle + turn * STRAY_ANGLE + 360) % 360;
    power = Math.max(MIN_POWER, Math.min(1, power * (1 + push * STRAY_POWER)));
  }
  const shot = roll(played, state.ball, angle, power);
  const strokes = state.strokes + 1 + (shot.outcome === "water" ? WATER_PENALTY : 0);
  const card =
    shot.outcome === "holed" ? strokes : strokes >= limitOf(played) ? capOf(played) : null;
  const last: LastShot = {
    hole: state.hole,
    from: state.ball,
    path: shot.path,
    jumps: shot.jumps,
    outcome: shot.outcome,
    strokes,
    card,
  };
  const earlier = state.traces?.hole === state.hole ? state.traces.shots : [];
  const traces = { hole: state.hole, shots: [...earlier, traceOf(shot.path, shot.jumps)] };
  const strayed = rng === undefined ? {} : { rng };
  if (card === null) {
    return {
      ...state,
      ...strayed,
      ball: shot.outcome === "water" ? state.ball : shot.end,
      strokes,
      shots: state.shots + 1,
      last,
      traces,
    };
  }
  const next = state.hole + 1;
  return {
    ...state,
    ...strayed,
    hole: next,
    ball: next < state.course.length ? state.course[next].tee : shot.end,
    strokes: 0,
    cards: [...state.cards, card],
    shots: state.shots + 1,
    last,
    traces,
  };
}

export type MinigolfView = Omit<MinigolfState, "rng"> & { par: number; over: boolean };

export function view(state: MinigolfState): MinigolfView {
  const { rng: _rng, ...shown } = state;
  return { ...shown, par: parOf(state.course), over: isOver(state) };
}

export function parOf(course: readonly Hole[]): number {
  return course.reduce((sum, { par }) => sum + par, 0);
}

// The round's total: every finished hole's card, and the cap for each one
// it never finished.
export function total(state: MinigolfState): number {
  const played = state.cards.reduce((sum, card) => sum + card, 0);
  const unplayed = state.course
    .slice(state.cards.length)
    .reduce((sum, hole) => sum + capOf(hole), 0);
  return played + unplayed;
}

export function score(state: MinigolfState): DailyScore {
  const value = total(state);
  // The holes' cards ride along with the chart's line, for the page a
  // challenge opens to set them beside its own.
  const cards = state.cards.join(" ");
  if (!isOver(state)) {
    return {
      value,
      detail: { key: "chart.ended", values: { count: state.cards.length, cards } },
    };
  }
  const toPar = value - parOf(state.course);
  const detail: ActionDescription =
    toPar === 0
      ? { key: "chart.even", values: { cards } }
      : toPar < 0
        ? { key: "chart.under", values: { count: -toPar, cards } }
        : { key: "chart.over", values: { count: toPar, cards } };
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
