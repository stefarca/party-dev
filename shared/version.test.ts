import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "./version";

describe("PROTOCOL_VERSION", () => {
  it("is a positive integer", () => {
    expect(PROTOCOL_VERSION).toBe(3);
  });
});
