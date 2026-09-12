import { describe, expect, it, vi } from "vitest";

import { MIN_NUDGE_INTERVAL_MS, sendSlackNudge, shouldNudge } from "./nudge";

// Pure parts only (worker/nudge.ts's own file comment): message composition
// and the rate-limit predicate. `MatchDO.nudgeHook`'s wiring (connectivity
// filtering, ctx.waitUntil, persisting `nudgedAt`) is exercised separately,
// by hand in local dev per the plan's verification script — this repo has no
// Durable Object integration test harness for that (see worker/match.test.ts's
// own comment on why).

function fakeEnv(webhookUrl: string | undefined): Env {
  return { SLACK_WEBHOOK_URL: webhookUrl } as unknown as Env;
}

describe("sendSlackNudge", () => {
  it("no-ops (and never throws) when SLACK_WEBHOOK_URL is unset", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      sendSlackNudge(fakeEnv(undefined), {
        matchId: "m1",
        gameName: "Connect 4",
        players: [{ id: "bob", nickname: "Bob" }],
        url: "http://localhost:5173/m/M1",
      })
    ).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("sends one POST with a single-player message naming the game and match URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    await sendSlackNudge(fakeEnv("http://example.test/hook"), {
      matchId: "m1",
      gameName: "Connect 4",
      players: [{ id: "bob", nickname: "Bob" }],
      url: "http://localhost:5173/m/M1",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://example.test/hook");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string) as { text: string };
    expect(body.text).toContain("Bob");
    expect(body.text).toContain("Connect 4");
    expect(body.text).toContain("http://localhost:5173/m/M1");
    fetchSpy.mockRestore();
  });

  it("batches several players into exactly one POST, not one per player", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    await sendSlackNudge(fakeEnv("http://example.test/hook"), {
      matchId: "m2",
      gameName: "Trivia",
      players: [
        { id: "a", nickname: "Alice" },
        { id: "b", nickname: "Bob" },
        { id: "c", nickname: "Carol" },
      ],
      url: "http://localhost:5173/m/M2",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init?.body as string) as { text: string };
    expect(body.text).toContain("Alice");
    expect(body.text).toContain("Bob");
    expect(body.text).toContain("Carol");
    fetchSpy.mockRestore();
  });

  it("never throws when fetch rejects (a hung/failed Slack request)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(
      sendSlackNudge(fakeEnv("http://example.test/hook"), {
        matchId: "m1",
        gameName: "Connect 4",
        players: [{ id: "bob", nickname: "Bob" }],
        url: "http://localhost:5173/m/M1",
      })
    ).resolves.toBeUndefined();
    fetchSpy.mockRestore();
  });

  it("no-ops when there are no players to nudge", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await sendSlackNudge(fakeEnv("http://example.test/hook"), {
      matchId: "m1",
      gameName: "Connect 4",
      players: [],
      url: "http://localhost:5173/m/M1",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("shouldNudge", () => {
  const NOW = 1_000_000;

  it("is eligible the first time (never nudged before)", () => {
    expect(shouldNudge(undefined, "bob", NOW, NOW)).toBe(true);
  });

  it("is not eligible again within the same waiting spell (already nudged since becomeWaitingAt)", () => {
    const becameWaitingAt = NOW - 1000;
    const nudgedAt = NOW - 500; // nudged after this spell began
    expect(shouldNudge(nudgedAt, "bob", NOW, becameWaitingAt)).toBe(false);
  });

  it("is eligible again on a following turn once the prior nudge predates it and the floor has elapsed", () => {
    const nudgedAt = NOW - MIN_NUDGE_INTERVAL_MS - 1;
    const becameWaitingAt = NOW; // a fresh waiting spell, after the old nudge
    expect(shouldNudge(nudgedAt, "bob", NOW, becameWaitingAt)).toBe(true);
  });

  it("enforces the hard floor even for a fresh waiting spell", () => {
    const nudgedAt = NOW - 1000; // well within MIN_NUDGE_INTERVAL_MS
    const becameWaitingAt = NOW; // looks like a brand new spell
    expect(shouldNudge(nudgedAt, "bob", NOW, becameWaitingAt)).toBe(false);
  });

  it("is eligible exactly at the floor boundary", () => {
    const nudgedAt = NOW - MIN_NUDGE_INTERVAL_MS;
    const becameWaitingAt = NOW;
    expect(shouldNudge(nudgedAt, "bob", NOW, becameWaitingAt)).toBe(true);
  });
});
