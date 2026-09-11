import { describe, expect, it } from "vitest";

import { IdentityRequestSchema } from "./protocol";

describe("IdentityRequestSchema", () => {
  it("accepts a normal nickname", () => {
    expect(IdentityRequestSchema.safeParse({ nickname: "alice" }).success).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    const result = IdentityRequestSchema.safeParse({ nickname: "  bob  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.nickname).toBe("bob");
  });

  it("rejects an empty nickname", () => {
    expect(IdentityRequestSchema.safeParse({ nickname: "" }).success).toBe(false);
  });

  it("rejects a whitespace-only nickname", () => {
    expect(IdentityRequestSchema.safeParse({ nickname: "   " }).success).toBe(false);
  });

  it("accepts exactly 24 characters", () => {
    expect(IdentityRequestSchema.safeParse({ nickname: "a".repeat(24) }).success).toBe(true);
  });

  it("rejects 25 characters", () => {
    expect(IdentityRequestSchema.safeParse({ nickname: "a".repeat(25) }).success).toBe(false);
  });

  it("rejects control characters", () => {
    const withControlChar = `bad${String.fromCharCode(7)}name`;
    expect(IdentityRequestSchema.safeParse({ nickname: withControlChar }).success).toBe(false);
  });
});
