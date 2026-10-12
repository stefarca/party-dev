import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransport,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

import { decodeBase64Url, encodeBase64Url } from "../shared/base64url";
import type { SecurityState } from "../shared/protocol";
import { sign, verify } from "./auth";

// The optional lock on a nickname: a PIN, passkeys, or both. A player who
// sets neither keeps the app's no-registration sign-in. One who sets either
// can only be signed into from a new device with it, or with the approval of
// a device already signed in.
//
// Locking sets `players.locked_at` the first time and never clears it: the
// achievement for locking reads it, and an achievement is never taken back.

// ---------------------------------------------------------------------
// PIN
// ---------------------------------------------------------------------

// Wrong guesses allowed before the PIN stops being checked for a while, and
// that while, which doubles with every further round, up to a day. A PIN is
// short by design, so this limit is what protects it, not its hash: four
// digits at five guesses per quarter-hour, doubling, take years.
export const PIN_ATTEMPTS = 5;
export const PIN_BLOCK_MS = 15 * 60 * 1000;
export const PIN_BLOCK_MAX_MS = 24 * 60 * 60 * 1000;

// What is stored is an HMAC under SESSION_SECRET, not a slow hash: a slow
// hash would cost more CPU than a Worker request has, and over a PIN's few
// thousand values it would not slow down anyone who had the database anyway.
// The key is what such a person would lack. Rotating SESSION_SECRET therefore
// voids every PIN, as it voids every session.
function pinPayload(playerId: string, salt: string, pin: string): string {
  return `pin\0${playerId}\0${salt}\0${pin}`;
}

export async function setPin(
  db: D1Database,
  secret: string,
  playerId: string,
  pin: string,
  now: number,
): Promise<boolean> {
  const salt = encodeBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await sign(pinPayload(playerId, salt, pin), secret);
  const result = await db
    .prepare(
      `UPDATE players
       SET pin_hash = ?, pin_salt = ?, pin_failures = 0, pin_blocked_until = NULL,
           locked_at = COALESCE(locked_at, ?)
       WHERE id = ?`,
    )
    .bind(hash, salt, now, playerId)
    .run();
  return result.meta.changes > 0;
}

export async function removePin(db: D1Database, playerId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE players SET pin_hash = NULL, pin_salt = NULL, pin_failures = 0, pin_blocked_until = NULL
       WHERE id = ?`,
    )
    .bind(playerId)
    .run();
}

export type PinCheck =
  | { ok: true }
  | { ok: false; reason: "wrong" | "no_pin" }
  | { ok: false; reason: "blocked"; retryAt: number };

// Checks `pin` against the player's, counting a wrong one towards the block.
// A blocked PIN is not checked at all, so a right guess during a block says
// nothing either.
export async function checkPin(
  db: D1Database,
  secret: string,
  playerId: string,
  pin: string,
  now: number,
): Promise<PinCheck> {
  const row = await db
    .prepare(
      `SELECT pin_hash AS hash, pin_salt AS salt, pin_blocked_until AS blockedUntil
       FROM players WHERE id = ?`,
    )
    .bind(playerId)
    .first<{ hash: string | null; salt: string | null; blockedUntil: number | null }>();
  if (!row?.hash || !row.salt) return { ok: false, reason: "no_pin" };
  if (row.blockedUntil !== null && row.blockedUntil > now) {
    return { ok: false, reason: "blocked", retryAt: row.blockedUntil };
  }

  if (await verify(pinPayload(playerId, row.salt, pin), row.hash, secret)) {
    await db
      .prepare("UPDATE players SET pin_failures = 0, pin_blocked_until = NULL WHERE id = ?")
      .bind(playerId)
      .run();
    return { ok: true };
  }

  // Counted in the database, not from the value read above, so guesses sent
  // in parallel each count.
  const counted = await db
    .prepare(
      "UPDATE players SET pin_failures = pin_failures + 1 WHERE id = ? RETURNING pin_failures AS failures",
    )
    .bind(playerId)
    .first<{ failures: number }>();
  const failures = counted?.failures ?? 0;
  if (failures > 0 && failures % PIN_ATTEMPTS === 0) {
    const round = failures / PIN_ATTEMPTS;
    const retryAt = now + Math.min(PIN_BLOCK_MS * 2 ** (round - 1), PIN_BLOCK_MAX_MS);
    await db
      .prepare("UPDATE players SET pin_blocked_until = ? WHERE id = ?")
      .bind(retryAt, playerId)
      .run();
    return { ok: false, reason: "blocked", retryAt };
  }
  return { ok: false, reason: "wrong" };
}

// ---------------------------------------------------------------------
// Passkeys (WebAuthn, through @simplewebauthn/server)
// ---------------------------------------------------------------------

// Shown by the browser and the password manager next to the passkey.
const RP_NAME = "Pimpom";

// The relying party is the host the request came to, so a passkey made on
// the real domain works there, and one made on localhost works only there.
export interface RelyingParty {
  id: string;
  origin: string;
}

export function relyingParty(requestUrl: string): RelyingParty {
  const url = new URL(requestUrl);
  return { id: url.hostname, origin: url.origin };
}

interface PasskeyRow {
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
}

function transportsOf(row: Pick<PasskeyRow, "transports">): AuthenticatorTransport[] {
  if (!row.transports) return [];
  try {
    const parsed = JSON.parse(row.transports) as unknown;
    return Array.isArray(parsed) ? (parsed as AuthenticatorTransport[]) : [];
  } catch {
    return [];
  }
}

function passkeysOf(db: D1Database, playerId: string): Promise<{ results: PasskeyRow[] }> {
  return db
    .prepare(
      "SELECT credential_id, public_key, counter, transports FROM passkeys WHERE player_id = ?",
    )
    .bind(playerId)
    .all<PasskeyRow>();
}

export async function registrationOptions(
  db: D1Database,
  rp: RelyingParty,
  player: { id: string; nickname: string },
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { results } = await passkeysOf(db, player.id);
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.id,
    userName: player.nickname,
    userID: new Uint8Array(new TextEncoder().encode(player.id)),
    attestationType: "none",
    excludeCredentials: results.map((row) => ({
      id: row.credential_id,
      transports: transportsOf(row),
    })),
    // Discoverable where the authenticator can, so the password manager can
    // offer it; and the device's own unlock where it has one. Neither is
    // required: a security key without a PIN still makes a passkey here.
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
}

// Verifies a new passkey against the challenge it was made for and keeps it.
// False when the browser's answer does not check out.
export async function addPasskey(
  db: D1Database,
  rp: RelyingParty,
  playerId: string,
  challenge: string,
  response: RegistrationResponseJSON,
  now: number,
): Promise<boolean> {
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: false,
    });
  } catch (err) {
    console.error("passkey registration rejected", err);
    return false;
  }
  if (!verification.verified) return false;
  const { credential } = verification.registrationInfo;
  await db
    .prepare(
      `INSERT INTO passkeys (credential_id, player_id, public_key, counter, transports, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (credential_id) DO NOTHING`,
    )
    .bind(
      credential.id,
      playerId,
      encodeBase64Url(credential.publicKey),
      credential.counter,
      credential.transports ? JSON.stringify(credential.transports) : null,
      now,
    )
    .run();
  await db
    .prepare("UPDATE players SET locked_at = COALESCE(locked_at, ?) WHERE id = ?")
    .bind(now, playerId)
    .run();
  return true;
}

export async function removePasskeys(db: D1Database, playerId: string): Promise<void> {
  await db.prepare("DELETE FROM passkeys WHERE player_id = ?").bind(playerId).run();
}

// Options for signing in as `playerId` with one of their passkeys, or null
// when they have none.
export async function authenticationOptions(
  db: D1Database,
  rp: RelyingParty,
  playerId: string,
): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
  const { results } = await passkeysOf(db, playerId);
  if (results.length === 0) return null;
  return generateAuthenticationOptions({
    rpID: rp.id,
    allowCredentials: results.map((row) => ({
      id: row.credential_id,
      transports: transportsOf(row),
    })),
    userVerification: "preferred",
  });
}

// Verifies a passkey sign-in as `playerId`. The credential has to be one of
// theirs: a valid passkey for somebody else signs nobody in.
export async function checkPasskey(
  db: D1Database,
  rp: RelyingParty,
  playerId: string,
  challenge: string,
  response: AuthenticationResponseJSON,
  now: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT credential_id, public_key, counter, transports FROM passkeys
       WHERE credential_id = ? AND player_id = ?`,
    )
    .bind(response.id, playerId)
    .first<PasskeyRow>();
  if (!row) return false;

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: {
        id: row.credential_id,
        publicKey: new Uint8Array(decodeBase64Url(row.public_key)),
        counter: row.counter,
        transports: transportsOf(row),
      },
      requireUserVerification: false,
    });
  } catch (err) {
    console.error("passkey sign-in rejected", err);
    return false;
  }
  if (!verification.verified) return false;
  await db
    .prepare("UPDATE passkeys SET counter = ?, last_used_at = ? WHERE credential_id = ?")
    .bind(verification.authenticationInfo.newCounter, now, row.credential_id)
    .run();
  return true;
}

// ---------------------------------------------------------------------
// The lock as a whole
// ---------------------------------------------------------------------

export async function securityState(db: D1Database, playerId: string): Promise<SecurityState> {
  const row = await db
    .prepare(
      `SELECT pin_hash IS NOT NULL AS pin,
              (SELECT COUNT(*) FROM passkeys WHERE player_id = ?1) AS passkeys
       FROM players WHERE id = ?1`,
    )
    .bind(playerId)
    .first<{ pin: number; passkeys: number }>();
  return { pin: row?.pin === 1, passkeys: row?.passkeys ?? 0 };
}

export function isLocked(state: SecurityState): boolean {
  return state.pin || state.passkeys > 0;
}
