import { decodeBase64Url, encodeBase64Url } from "../shared/base64url";
import type { SignInMethod, SignInNotices } from "../shared/protocol";

// Sign-ins to a nickname somebody already holds (`sign_ins`), which is the
// only kind that can be someone other than the owner. A brand-new nickname is
// claimed with no row here: there is nobody to ask, and nobody to warn.
//
// Three things are kept here. A request waits on the owner when they have a
// device that could answer it. Each sign-in that went through is listed on
// the owner's devices until one of them says it was them. And "sign out
// everywhere" lives here too, since it is the answer to a sign-in that was
// not.

// How long a request waits on an owner who has not locked their name before
// it lets the new device in anyway. Long enough to reach for the other
// device, short enough that someone whose phone is in a drawer is not locked
// out of their own account.
export const AUTO_ALLOW_MS = 2 * 60 * 1000;

// How long a request can be answered, or collected once answered.
export const REQUEST_TTL_MS = 10 * 60 * 1000;

// How recently a device of the owner's must have had the app open for a
// sign-in to wait on its approval. An open page reports every few seconds,
// and the registry notes it at most once a minute.
export const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

// How long a sign-in stays on the owner's devices if none of them answers it.
export const NOTICE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Requests one player can have waiting at once. A device that keeps asking
// is turned away rather than filling the owner's screen.
export const MAX_PENDING = 3;

export class TooManyRequestsError extends Error {
  constructor() {
    super("too many sign-in requests are waiting on this player");
    this.name = "TooManyRequestsError";
  }
}

// What the owner is told the device is. Read from the User-Agent, so it is
// only as true as the device says, and only ever a browser and a system,
// never anything that tells one person's phone from another's.
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const system = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /CrOS/.test(ua)
          ? "ChromeOS"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Windows/.test(ua)
              ? "Windows"
              : /Linux/.test(ua)
                ? "Linux"
                : null;
  // Order matters: Edge and Opera say Chrome, and Chrome says Safari.
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS\//.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? "Unknown device";
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return encodeBase64Url(new Uint8Array(digest));
}

function randomSecret(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

// Whether the owner has a device a request could reach right now: one with
// the app open lately, or one that takes push notifications.
export async function canApprove(db: D1Database, playerId: string, now: number): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT (SELECT last_seen_at FROM players WHERE id = ?1) >= ?2
              OR EXISTS (SELECT 1 FROM push_subscriptions WHERE player_id = ?1) AS reachable`,
    )
    .bind(playerId, now - ACTIVE_WINDOW_MS)
    .first<{ reachable: number | null }>();
  return row?.reachable === 1;
}

export interface OpenedRequest {
  id: string;
  // Handed to the requesting device alone, and stored only as a hash: it is
  // what lets that device, and no other, collect the session.
  secret: string;
  autoAt: number | null;
  expiresAt: number;
}

// Asks the owner to let `device` in. With `autoAt`, it goes through by itself
// at that moment unless the owner has turned it down.
export async function openRequest(
  db: D1Database,
  request: { playerId: string; device: string; now: number; autoAt: number | null },
): Promise<OpenedRequest> {
  const waiting = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM sign_ins
       WHERE player_id = ? AND status = 'pending' AND expires_at > ?`,
    )
    .bind(request.playerId, request.now)
    .first<{ n: number }>();
  if ((waiting?.n ?? 0) >= MAX_PENDING) throw new TooManyRequestsError();

  const id = crypto.randomUUID();
  const secret = randomSecret();
  const expiresAt = request.now + REQUEST_TTL_MS;
  await db
    .prepare(
      `INSERT INTO sign_ins (id, player_id, secret_hash, device, status, created_at, auto_at, expires_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .bind(
      id,
      request.playerId,
      await sha256(secret),
      request.device,
      request.now,
      request.autoAt,
      expiresAt,
    )
    .run();
  return { id, secret, autoAt: request.autoAt, expiresAt };
}

// Records a sign-in that went through without waiting on anyone, so the
// owner's devices still hear about it. Its id goes into the new session.
export async function recordSignIn(
  db: D1Database,
  signIn: { playerId: string; device: string; method: SignInMethod; now: number },
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO sign_ins (id, player_id, device, status, method, created_at, expires_at, completed_at)
       VALUES (?, ?, ?, 'completed', ?, ?, ?, ?)`,
    )
    .bind(id, signIn.playerId, signIn.device, signIn.method, signIn.now, signIn.now, signIn.now)
    .run();
  return id;
}

export type PollResult =
  | { status: "pending"; autoAt: number | null; expiresAt: number }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "ready"; playerId: string; method: SignInMethod };

interface RequestRow {
  player_id: string;
  status: string;
  auto_at: number | null;
  expires_at: number;
}

// Where the request `id` stands, for the device holding its `secret`. A
// request the owner approved, or one whose `autoAt` has passed, is collected
// by this call: it comes back "ready" exactly once, and the caller issues
// the session. Anything that does not match the secret reads as expired, so
// a guessed id says nothing.
export async function pollRequest(
  db: D1Database,
  id: string,
  secret: string,
  now: number,
): Promise<PollResult> {
  // Not a valid secret at all: nothing to look up.
  try {
    if (decodeBase64Url(secret).length !== 32) return { status: "expired" };
  } catch {
    return { status: "expired" };
  }
  const row = await db
    .prepare(
      `SELECT player_id, status, auto_at, expires_at FROM sign_ins
       WHERE id = ? AND secret_hash = ?`,
    )
    .bind(id, await sha256(secret))
    .first<RequestRow>();
  if (!row) return { status: "expired" };
  if (row.status === "denied") return { status: "denied" };
  if (row.status === "completed" || row.expires_at <= now) return { status: "expired" };

  const method: SignInMethod | null =
    row.status === "approved"
      ? "approved"
      : row.auto_at !== null && row.auto_at <= now
        ? "auto"
        : null;
  if (!method) return { status: "pending", autoAt: row.auto_at, expiresAt: row.expires_at };

  // Conditional on the status it was read with, so two polls racing each
  // other collect it once, and an owner's "deny" that lands first wins.
  const done = await db
    .prepare(
      `UPDATE sign_ins SET status = 'completed', method = ?, completed_at = ?, secret_hash = NULL
       WHERE id = ? AND status = ?`,
    )
    .bind(method, now, id, row.status)
    .run();
  if (done.meta.changes === 0) return pollRequest(db, id, secret, now);
  return { status: "ready", playerId: row.player_id, method };
}

// The owner's answer to a waiting request. An approval counts as the owner
// having seen it, so it is not listed again as one to worry about. False when
// there is no such request waiting on this player.
export async function decideRequest(
  db: D1Database,
  playerId: string,
  id: string,
  approve: boolean,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE sign_ins
       SET status = ?, acknowledged_at = CASE WHEN ? THEN ? ELSE acknowledged_at END
       WHERE id = ? AND player_id = ? AND status = 'pending' AND expires_at > ?`,
    )
    .bind(approve ? "approved" : "denied", approve ? 1 : 0, now, id, playerId, now)
    .run();
  return result.meta.changes > 0;
}

// What the owner's devices show: the requests waiting on them, and the
// sign-ins that went through in the last week that nobody has answered.
// `ownSignIn` is the sign-in that put the asking device here, which it does
// not need to be told about.
export async function signInNotices(
  db: D1Database,
  playerId: string,
  ownSignIn: string | undefined,
  now: number,
): Promise<SignInNotices> {
  const { results } = await db
    .prepare(
      `SELECT id, device, status, method, created_at, auto_at, completed_at FROM sign_ins
       WHERE player_id = ? AND id IS NOT ?
         AND ((status = 'pending' AND expires_at > ?)
              OR (status = 'completed' AND acknowledged_at IS NULL AND completed_at > ?))
       ORDER BY created_at DESC
       LIMIT 20`,
    )
    .bind(playerId, ownSignIn ?? null, now, now - NOTICE_WINDOW_MS)
    .all<{
      id: string;
      device: string;
      status: string;
      method: SignInMethod | null;
      created_at: number;
      auto_at: number | null;
      completed_at: number | null;
    }>();
  return {
    pending: results
      .filter((r) => r.status === "pending")
      .map((r) => ({ id: r.id, device: r.device, createdAt: r.created_at, autoAt: r.auto_at })),
    recent: results
      .filter((r) => r.status === "completed")
      .map((r) => ({
        id: r.id,
        device: r.device,
        method: r.method ?? "open",
        at: r.completed_at ?? r.created_at,
      })),
  };
}

// "That was me": the sign-in is no longer listed on any of the owner's devices.
export async function acknowledgeSignIn(
  db: D1Database,
  playerId: string,
  id: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE sign_ins SET acknowledged_at = ?
       WHERE id = ? AND player_id = ? AND acknowledged_at IS NULL`,
    )
    .bind(now, id, playerId)
    .run();
}

// Signs every device out of `playerId` but the one that asks, and returns the
// epoch that device's new cookie carries. Every request still waiting is
// turned down, every sign-in listed is taken as answered, and every push
// subscription but `keepEndpoint` is dropped, since a device signed out of
// this player must stop being told about its turns.
export async function signOutEverywhere(
  db: D1Database,
  playerId: string,
  keepEndpoint: string | undefined,
  now: number,
): Promise<number> {
  await db
    .prepare("UPDATE players SET session_epoch = session_epoch + 1 WHERE id = ?")
    .bind(playerId)
    .run();
  await db
    .prepare(
      `UPDATE sign_ins SET status = 'denied'
       WHERE player_id = ? AND status IN ('pending', 'approved')`,
    )
    .bind(playerId)
    .run();
  await db
    .prepare(
      "UPDATE sign_ins SET acknowledged_at = ? WHERE player_id = ? AND acknowledged_at IS NULL",
    )
    .bind(now, playerId)
    .run();
  await db
    .prepare("DELETE FROM push_subscriptions WHERE player_id = ? AND endpoint IS NOT ?")
    .bind(playerId, keepEndpoint ?? null)
    .run();
  const row = await db
    .prepare("SELECT session_epoch AS epoch FROM players WHERE id = ?")
    .bind(playerId)
    .first<{ epoch: number }>();
  return row?.epoch ?? 0;
}
