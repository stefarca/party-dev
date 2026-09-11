import { describe, expect, it } from "vitest";

import { nextInt, nextUint32, shuffle } from "./prng";

describe("nextUint32", () => {
  it("is deterministic for a fixed seed", () => {
    const a = nextUint32(12345);
    const b = nextUint32(12345);
    expect(a).toEqual(b);
  });

  it("produces a value in [0, 2^32) and advances the state", () => {
    const [value, next] = nextUint32(1);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(2 ** 32);
    expect(Number.isInteger(next)).toBe(true);
  });

  it("produces a long non-repeating sequence from one seed", () => {
    let state = 42;
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const [value, next] = nextUint32(state);
      state = next;
      seen.add(value);
    }
    // Extremely unlikely to collide 1000 draws if the generator is any good.
    expect(seen.size).toBe(1000);
  });
});

describe("nextInt", () => {
  it("is deterministic for a fixed seed and bound", () => {
    expect(nextInt(999, 6)).toEqual(nextInt(999, 6));
  });

  it("stays within [0, maxExclusive)", () => {
    let state = 7;
    for (let i = 0; i < 200; i++) {
      const [value, next] = nextInt(state, 6);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
      state = next;
    }
  });

  it("rejects a non-positive bound", () => {
    expect(() => nextInt(1, 0)).toThrow();
    expect(() => nextInt(1, -1)).toThrow();
  });
});

describe("shuffle", () => {
  it("is deterministic for a fixed seed", () => {
    const items = [1, 2, 3, 4, 5];
    const [a] = shuffle(items, 2024);
    const [b] = shuffle(items, 2024);
    expect(a).toEqual(b);
  });

  it("never mutates the input array", () => {
    const items = [1, 2, 3, 4, 5];
    const copy = [...items];
    shuffle(items, 2024);
    expect(items).toEqual(copy);
  });

  it("returns a permutation of the input (same elements, same length)", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    const [shuffled] = shuffle(items, 1);
    expect(shuffled).toHaveLength(items.length);
    expect([...shuffled].sort()).toEqual([...items].sort());
  });
});
