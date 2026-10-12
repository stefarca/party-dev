import { beforeEach, describe, expect, it } from "vitest";

import { createMigratedDb } from "./__fixtures__/d1";
import {
  PIN_ATTEMPTS,
  PIN_BLOCK_MS,
  checkPin,
  isLocked,
  removePasskeys,
  removePin,
  securityState,
  setPin,
} from "./lock";
import { claimNickname } from "./players";

// The PIN's whole protection is the limit on wrong guesses, and that limit is
// counted in SQL, so this runs against the real migrations. Passkey
// verification is @simplewebauthn/server's, and is exercised end to end by
// e2e/account.spec.ts with a virtual authenticator.

const SECRET = "test-secret";
const T0 = Date.UTC(2026, 9, 11, 12);

let db: D1Database;
let ada: string;

beforeEach(async () => {
  db = createMigratedDb();
  ada = (await claimNickname(db, "Ada")).player.id;
});

async function lockedAt(): Promise<number | null> {
  const row = await db
    .prepare("SELECT locked_at AS at FROM players WHERE id = ?")
    .bind(ada)
    .first<{ at: number | null }>();
  return row?.at ?? null;
}

describe("a PIN", () => {
  it("is checked, and never stored as typed", async () => {
    expect(await setPin(db, SECRET, ada, "1234", T0)).toBe(true);
    const row = await db
      .prepare("SELECT pin_hash AS hash FROM players WHERE id = ?")
      .bind(ada)
      .first<{ hash: string }>();
    expect(row?.hash).not.toContain("1234");

    expect(await checkPin(db, SECRET, ada, "1234", T0)).toEqual({ ok: true });
    expect(await checkPin(db, SECRET, ada, "4321", T0)).toEqual({ ok: false, reason: "wrong" });
    // Under another key, the same PIN is not the same PIN.
    expect((await checkPin(db, "other-secret", ada, "1234", T0)).ok).toBe(false);
  });

  it("is not there for a player who never set one", async () => {
    expect(await checkPin(db, SECRET, ada, "1234", T0)).toEqual({ ok: false, reason: "no_pin" });
  });

  it("stops being checked after too many wrong guesses, longer each round", async () => {
    await setPin(db, SECRET, ada, "1234", T0);
    for (let i = 1; i < PIN_ATTEMPTS; i++) {
      expect((await checkPin(db, SECRET, ada, "0000", T0)).ok).toBe(false);
    }
    expect(await checkPin(db, SECRET, ada, "0000", T0)).toEqual({
      ok: false,
      reason: "blocked",
      retryAt: T0 + PIN_BLOCK_MS,
    });
    // The right PIN is not even checked while the block holds.
    expect(await checkPin(db, SECRET, ada, "1234", T0 + 1000)).toMatchObject({
      reason: "blocked",
    });

    const later = T0 + PIN_BLOCK_MS;
    for (let i = 1; i < PIN_ATTEMPTS; i++) await checkPin(db, SECRET, ada, "0000", later);
    expect(await checkPin(db, SECRET, ada, "0000", later)).toEqual({
      ok: false,
      reason: "blocked",
      retryAt: later + 2 * PIN_BLOCK_MS,
    });

    // A right guess once the block is over starts the count again.
    const after = later + 2 * PIN_BLOCK_MS;
    expect(await checkPin(db, SECRET, ada, "1234", after)).toEqual({ ok: true });
    expect(await checkPin(db, SECRET, ada, "0000", after)).toEqual({
      ok: false,
      reason: "wrong",
    });
  });
});

describe("the lock", () => {
  it("is on with a PIN or a passkey, and remembers when it first went on", async () => {
    expect(isLocked(await securityState(db, ada))).toBe(false);
    await setPin(db, SECRET, ada, "1234", T0);
    expect(await securityState(db, ada)).toEqual({ pin: true, passkeys: 0 });
    expect(await lockedAt()).toBe(T0);

    // Changing the PIN is not locking for the first time.
    await setPin(db, SECRET, ada, "5678", T0 + 1000);
    expect(await lockedAt()).toBe(T0);

    await db
      .prepare(
        "INSERT INTO passkeys (credential_id, player_id, public_key, counter, created_at) VALUES ('cred', ?, 'key', 0, ?)",
      )
      .bind(ada, T0)
      .run();
    await removePin(db, ada);
    expect(await securityState(db, ada)).toEqual({ pin: false, passkeys: 1 });
    expect(isLocked(await securityState(db, ada))).toBe(true);

    // Taking it all off keeps the achievement's record of it.
    await removePasskeys(db, ada);
    expect(isLocked(await securityState(db, ada))).toBe(false);
    expect(await lockedAt()).toBe(T0);
  });
});
