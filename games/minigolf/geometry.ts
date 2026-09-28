import type { Area, Point } from "./game";

// Compass bearing from `from` to `to`, in whole degrees clockwise from up.
export function bearing(from: Point, to: Point): number {
  const degrees = (Math.atan2(to[0] - from[0], from[1] - to[1]) * 180) / Math.PI;
  return Math.round((degrees + 360) % 360) % 360;
}

export function distance(from: Point, to: Point): number {
  return Math.hypot(to[0] - from[0], to[1] - from[1]);
}

export const points = (area: Area) => area.map(([x, y]) => `${x},${y}`).join(" ");

// The rotation that turns a downward chevron to point along `fall`.
export function fallRotation([x, y]: Point): number {
  return (Math.atan2(-x, y) * 180) / Math.PI;
}

// The bounding box of `area`, grown by `pad` on every side.
export function boxOf(area: Area, pad: number) {
  const xs = area.map(([x]) => x);
  const ys = area.map(([, y]) => y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, width: Math.max(...xs) + pad - x, height: Math.max(...ys) + pad - y };
}

// How far, in course units, one tile of the ripple and chevron patterns
// spans along the way it drifts, and how far apart the rows of ripples are.
export const WAVE_TILE = 10;
export const WAVE_ROWS = 3;
export const SLOPE_TILE = 8;

// Where a pond's ripple pattern starts, so its rows sit evenly between its
// top and bottom, clear of its shore, rather than wherever the course's grid
// would cut them. The pattern draws its first row 0.75 below its start.
export function wavesFrom(area: Area): number {
  const top = Math.min(...area.map(([, y]) => y));
  const height = Math.max(...area.map(([, y]) => y)) - top;
  const rows = Math.floor(height / WAVE_ROWS);
  return top + (height - WAVE_ROWS * (rows - 1)) / 2 - 0.75;
}
