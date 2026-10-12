import { beforeEach, describe, expect, it } from "vitest";

import { createMigratedDb } from "./__fixtures__/d1";
import { claimNickname, touchPlayer } from "./players";
import {
  ACTIVE_WINDOW_MS,
  AUTO_ALLOW_MS,
  MAX_PENDING,
  NOTICE_WINDOW_MS,
  TooManyRequestsError,
  acknowledgeSignIn,
  canApprove,
  decideRequest,
  deviceLabel,
  openRequest,
  pollRequest,
  recordSignIn,
  signInNotices,
  signOutEverywhere,
} from "./signins";

// Whether a sign-in waits, goes through or is turned away is decided in SQL as
// much as in code (a conditional UPDATE is what makes a request collectable
// once), so this runs against the real migrations.

const T0 = Date.UTC(2026, 9, 11, 12);

let db: D1Database;
let ada: string;

beforeEach(async () => {
  db = createMigratedDb();
  ada = (await claimNickname(db, "Ada")).player.id;
});

describe("deviceLabel", () => {
  it("names a browser and a system, and nothing more", () => {
    expect(
      deviceLabel(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
      ),
    ).toBe("Chrome on Android");
    expect(
      deviceLabel(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari on iPhone");
    expect(
      deviceLabel(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0",
      ),
    ).toBe("Edge on Windows");
    expect(deviceLabel(undefined)).toBe("Unknown device");
  });
});

describe("canApprove", () => {
  it("is true while one of the owner's devices has had the app open lately", async () => {
    await db.prepare("UPDATE players SET last_seen_at = ? WHERE id = ?").bind(T0, ada).run();
    expect(await canApprove(db, ada, T0 + ACTIVE_WINDOW_MS - 1)).toBe(true);
    expect(await canApprove(db, ada, T0 + ACTIVE_WINDOW_MS + 1)).toBe(false);
  });

  it("is true for an owner with a device that takes notifications, however long ago", async () => {
    await db.prepare("UPDATE players SET last_seen_at = 0 WHERE id = ?").bind(ada).run();
    await db
      .prepare(
        "INSERT INTO push_subscriptions (endpoint, player_id, p256dh, auth, created_at, last_seen_at) VALUES ('e', ?, 'k', 'a', 0, 0)",
      )
      .bind(ada)
      .run();
    expect(await canApprove(db, ada, T0)).toBe(true);
  });

  it("notes an open page at most once a minute", async () => {
    await db.prepare("UPDATE players SET last_seen_at = ? WHERE id = ?").bind(T0, ada).run();
    await touchPlayer(db, ada, T0 + 30_000);
    const row = await db
      .prepare("SELECT last_seen_at AS at FROM players WHERE id = ?")
      .bind(ada)
      .first<{ at: number }>();
    expect(row?.at).toBe(T0);
    await touchPlayer(db, ada, T0 + 60_000);
    const later = await db
      .prepare("SELECT last_seen_at AS at FROM players WHERE id = ?")
      .bind(ada)
      .first<{ at: number }>();
    expect(later?.at).toBe(T0 + 60_000);
  });
});

describe("a sign-in request", () => {
  function open(autoAt: number | null = T0 + AUTO_ALLOW_MS) {
    return openRequest(db, { playerId: ada, device: "Chrome on Android", now: T0, autoAt });
  }

  it("waits until the owner answers", async () => {
    const request = await open();
    expect(await pollRequest(db, request.id, request.secret, T0 + 1000)).toEqual({
      status: "pending",
      autoAt: T0 + AUTO_ALLOW_MS,
      expiresAt: request.expiresAt,
    });
  });

  it("goes through once the owner allows it, and only once", async () => {
    const request = await open();
    expect(await decideRequest(db, ada, request.id, true, T0 + 1000)).toBe(true);
    expect(await pollRequest(db, request.id, request.secret, T0 + 2000)).toEqual({
      status: "ready",
      playerId: ada,
      method: "approved",
    });
    expect((await pollRequest(db, request.id, request.secret, T0 + 3000)).status).toBe("expired");
  });

  it("goes through by itself when its clock runs out", async () => {
    const request = await open();
    expect(await pollRequest(db, request.id, request.secret, T0 + AUTO_ALLOW_MS)).toMatchObject({
      status: "ready",
      method: "auto",
    });
  });

  it("never goes through by itself on a locked name", async () => {
    const request = await open(null);
    expect((await pollRequest(db, request.id, request.secret, T0 + AUTO_ALLOW_MS)).status).toBe(
      "pending",
    );
  });

  it("stays out once the owner denies it, even after its clock would have let it in", async () => {
    const request = await open();
    expect(await decideRequest(db, ada, request.id, false, T0 + 1000)).toBe(true);
    expect((await pollRequest(db, request.id, request.secret, T0 + AUTO_ALLOW_MS)).status).toBe(
      "denied",
    );
    // An answer is given once.
    expect(await decideRequest(db, ada, request.id, true, T0 + 2000)).toBe(false);
  });

  it("can only be answered by its owner, and only be collected with its secret", async () => {
    const bob = (await claimNickname(db, "Bob")).player.id;
    const request = await open();
    expect(await decideRequest(db, bob, request.id, true, T0 + 1000)).toBe(false);
    const forged = await open();
    expect((await pollRequest(db, request.id, forged.secret, T0 + AUTO_ALLOW_MS)).status).toBe(
      "expired",
    );
    expect((await pollRequest(db, request.id, "not-a-secret", T0)).status).toBe("expired");
  });

  it("expires", async () => {
    const request = await open();
    await decideRequest(db, ada, request.id, true, T0 + 1000);
    expect((await pollRequest(db, request.id, request.secret, request.expiresAt)).status).toBe(
      "expired",
    );
  });

  it("turns a device away that keeps asking", async () => {
    for (let i = 0; i < MAX_PENDING; i++) await open();
    await expect(open()).rejects.toBeInstanceOf(TooManyRequestsError);
  });
});

describe("the owner's notices", () => {
  it("lists waiting requests and unanswered sign-ins, but not the device's own", async () => {
    const pending = await openRequest(db, {
      playerId: ada,
      device: "Firefox on Linux",
      now: T0,
      autoAt: null,
    });
    const other = await recordSignIn(db, {
      playerId: ada,
      device: "Safari on iPhone",
      method: "open",
      now: T0,
    });
    const own = await recordSignIn(db, {
      playerId: ada,
      device: "Chrome on Mac",
      method: "pin",
      now: T0,
    });

    const notices = await signInNotices(db, ada, own, T0 + 1000);
    expect(notices.pending).toEqual([
      { id: pending.id, device: "Firefox on Linux", createdAt: T0, autoAt: null },
    ]);
    expect(notices.recent).toEqual([
      { id: other, device: "Safari on iPhone", method: "open", at: T0 },
    ]);

    await acknowledgeSignIn(db, ada, other, T0 + 2000);
    expect((await signInNotices(db, ada, own, T0 + 3000)).recent).toEqual([]);
  });

  it("does not list a sign-in the owner approved, or one older than a week", async () => {
    const request = await openRequest(db, {
      playerId: ada,
      device: "Firefox on Linux",
      now: T0,
      autoAt: null,
    });
    await decideRequest(db, ada, request.id, true, T0 + 1000);
    await pollRequest(db, request.id, request.secret, T0 + 2000);
    await recordSignIn(db, { playerId: ada, device: "Old", method: "open", now: T0 });

    const notices = await signInNotices(db, ada, undefined, T0 + NOTICE_WINDOW_MS + 1);
    expect(notices).toEqual({ pending: [], recent: [] });
  });
});

describe("signOutEverywhere", () => {
  it("moves the epoch on, turns down what waits, and keeps only this device's notifications", async () => {
    const request = await openRequest(db, {
      playerId: ada,
      device: "Firefox on Linux",
      now: T0,
      autoAt: T0 + AUTO_ALLOW_MS,
    });
    await recordSignIn(db, { playerId: ada, device: "Safari on iPhone", method: "auto", now: T0 });
    for (const endpoint of ["mine", "theirs"]) {
      await db
        .prepare(
          "INSERT INTO push_subscriptions (endpoint, player_id, p256dh, auth, created_at, last_seen_at) VALUES (?, ?, 'k', 'a', 0, 0)",
        )
        .bind(endpoint, ada)
        .run();
    }

    expect(await signOutEverywhere(db, ada, "mine", T0 + 1000)).toBe(1);
    expect((await pollRequest(db, request.id, request.secret, T0 + AUTO_ALLOW_MS)).status).toBe(
      "denied",
    );
    expect(await signInNotices(db, ada, undefined, T0 + 2000)).toEqual({ pending: [], recent: [] });
    const { results } = await db
      .prepare("SELECT endpoint FROM push_subscriptions WHERE player_id = ?")
      .bind(ada)
      .all<{ endpoint: string }>();
    expect(results).toEqual([{ endpoint: "mine" }]);
  });
});
