import { describe, expect, test } from "vitest";

import { addDays, dayEnd, dayOf, dayStart, isDay } from "./daily";

describe("dayOf", () => {
  test("is the UTC date, whatever the hour", () => {
    expect(dayOf(Date.UTC(2026, 8, 21, 0, 0, 0))).toBe("2026-09-21");
    expect(dayOf(Date.UTC(2026, 8, 21, 23, 59, 59, 999))).toBe("2026-09-21");
    expect(dayOf(Date.UTC(2026, 8, 22))).toBe("2026-09-22");
  });
});

describe("dayStart / dayEnd", () => {
  test("bound the day exactly, end exclusive", () => {
    expect(dayStart("2026-09-21")).toBe(Date.UTC(2026, 8, 21));
    expect(dayEnd("2026-09-21")).toBe(Date.UTC(2026, 8, 22));
    expect(dayOf(dayEnd("2026-09-21") - 1)).toBe("2026-09-21");
    expect(dayOf(dayEnd("2026-09-21"))).toBe("2026-09-22");
  });

  test("are NaN for something that is not a day", () => {
    expect(dayStart("yesterday")).toBeNaN();
    expect(dayEnd("2026-9-21")).toBeNaN();
  });
});

describe("isDay", () => {
  test.each(["2026-09-21", "2024-02-29", "2000-01-01"])("accepts %s", (day) => {
    expect(isDay(day)).toBe(true);
  });

  test.each(["2026-02-30", "2025-02-29", "2026-13-01", "2026-09-21T00:00", "21-09-2026", ""])(
    "rejects %j",
    (value) => {
      expect(isDay(value)).toBe(false);
    },
  );
});

describe("addDays", () => {
  test("steps across months and years", () => {
    expect(addDays("2026-09-21", 1)).toBe("2026-09-22");
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });
});
