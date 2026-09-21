// The daily games' calendar. A day is a UTC calendar date, written YYYY-MM-DD. It picks a daily
// game's board (every player gets the same one that day), keys the one run each player may have
// on it, and keys the chart that run is ranked on. Days turn over at midnight UTC for everyone at
// once, so a day's chart closes at one instant for all of its players, wherever they are.

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const DAY_MS = 24 * 60 * 60 * 1000;

// The day `epochMs` falls on.
export function dayOf(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

// The first instant of `day`, in epoch ms. NaN for a string that is not a day.
export function dayStart(day: string): number {
  return DAY_RE.test(day) ? Date.parse(`${day}T00:00:00Z`) : NaN;
}

// The instant `day` ends and the next begins: its runs close, and its chart is final.
export function dayEnd(day: string): number {
  return dayStart(day) + DAY_MS;
}

// Whether `value` names a real day. The pattern alone would let through "2026-02-30".
export function isDay(value: string): boolean {
  const start = dayStart(value);
  return Number.isFinite(start) && dayOf(start) === value;
}

// The day `n` days after `day` (before it, for a negative `n`).
export function addDays(day: string, n: number): string {
  return dayOf(dayStart(day) + n * DAY_MS);
}
