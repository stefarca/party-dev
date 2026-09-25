import { expect, test } from "vitest";

import { clock } from "./clock";

test("a stopwatch reads minutes and seconds, and hours once there are any", () => {
  expect(clock(0)).toBe("0:00");
  expect(clock(65_999)).toBe("1:05");
  expect(clock(3_729_000)).toBe("1:02:09");
});
