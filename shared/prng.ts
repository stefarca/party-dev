// Pure seeded PRNG (mulberry32). Binding game rule: a seeded PRNG must live
// *in game state*, never as `Math.random()` inside `reduce` — determinism
// buys replay, reconnect-by-replay, and eventually client-side prediction.
//
// There is no hidden module-level state anywhere in this file: every
// function takes the current 32-bit seed/state explicitly and returns the
// advanced state alongside the value. The caller (a `GameModule.init`/
// `reduce`) threads that returned state through its own game state and
// stores it there.

/** Advances the PRNG one step. Returns [value in [0, 2^32), nextState]. */
export function nextUint32(state: number): [value: number, next: number] {
  // mulberry32: https://github.com/bryc/code/blob/master/jshash/PRNGs.md
  const next = (state + 0x6d2b79f5) | 0;
  let z = next;
  z = Math.imul(z ^ (z >>> 15), z | 1);
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
  const value = (z ^ (z >>> 14)) >>> 0;
  return [value, next];
}

/** Advances the PRNG one step. Returns [value in [0, maxExclusive), nextState]. */
export function nextInt(state: number, maxExclusive: number): [value: number, next: number] {
  if (!(maxExclusive > 0)) {
    throw new RangeError("maxExclusive must be a positive number");
  }
  const [raw, next] = nextUint32(state);
  return [raw % maxExclusive, next];
}

/**
 * Fisher-Yates shuffle. Returns a new array (never mutates `items`) plus the
 * advanced PRNG state.
 */
export function shuffle<T>(items: T[], state: number): [items: T[], next: number] {
  const result = items.slice();
  let s = state;
  for (let i = result.length - 1; i > 0; i--) {
    const [j, next] = nextInt(s, i + 1);
    s = next;
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return [result, s];
}
