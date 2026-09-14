import { describe, expect, it } from "vitest";

import { MATCH_CODE_RE, generateMatchCode, normalizeMatchCode } from "./ids";

describe("generateMatchCode", () => {
  it("produces a 6-character code matching the unambiguous alphabet", () => {
    const code = generateMatchCode();
    expect(code).toHaveLength(6);
    expect(code).toMatch(MATCH_CODE_RE);
  });

  it("excludes ambiguous characters (I, O, 0, 1)", () => {
    const code = generateMatchCode();
    expect(code).not.toMatch(/[IO01]/);
  });

  it("is deterministic for a stubbed random", () => {
    const sequence = [0, 0.1, 0.2, 0.3, 0.4, 0.99];
    const makeStub = () => {
      let i = 0;
      return () => sequence[i++];
    };
    expect(generateMatchCode(makeStub())).toBe(generateMatchCode(makeStub()));
  });
});

describe("normalizeMatchCode", () => {
  it("uppercases and strips whitespace and dashes", () => {
    expect(normalizeMatchCode(" ab-cd-ef ")).toBe("ABCDEF");
  });

  it("round-trips a generated code through lowercasing", () => {
    const code = generateMatchCode();
    expect(normalizeMatchCode(code.toLowerCase())).toBe(code);
  });
});
