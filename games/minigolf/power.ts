import { MIN_POWER } from "./game";

// A shot's power, as the page offers it: by reach, its share of the furthest
// a shot rolls. Friction slows the ball by the same amount every moment, so
// how far it rolls grows with the square of how hard it was hit, and half
// power goes only a quarter as far. A slider or a drag that set the power
// itself would spend most of its travel on shots too long for any hole. The
// action still carries the power, so the server's rules never change.

// The least reach the page offers: a little over the least power's.
export const MIN_REACH = 0.01;

export function powerOf(reach: number): number {
  const clamped = Math.min(1, Math.max(MIN_REACH, reach));
  return Math.max(MIN_POWER, Math.round(Math.sqrt(clamped) * 1000) / 1000);
}

export function reachOf(power: number): number {
  return power * power;
}
