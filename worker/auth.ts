import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

// Nickname + HMAC-signed cookie. No
// passwords, no KV/D1 session store — the cookie itself is the session,
// authenticated with Web Crypto HMAC-SHA256 and a secret held in
// env.SESSION_SECRET (a Worker secret, never committed).
//
// What makes a cookie revocable anyway is the epoch it carries: "sign out
// everywhere" bumps `players.session_epoch`, and a cookie issued under an
// older one stops being a session on its next request.

export const SESSION_COOKIE = "party_session";

export interface Session {
  pid: string; // playerId — crypto.randomUUID(), minted once, preserved across nickname changes
  nick: string;
  iat: number; // epoch ms the session was first minted
  // The player's `session_epoch` when this cookie was issued. Absent on a
  // cookie from before epochs existed, which counts as epoch 0.
  ep?: number;
  // The sign-in (a `sign_ins` row) that put this device on a nickname
  // somebody already held, so the device does not list its own sign-in as
  // one to worry about. Absent for the device that claimed the nickname.
  sid?: string;
}

export type SessionBindings = {
  Bindings: Env;
  Variables: { session: Session | null };
};

// Thrown by the sign/verify helpers when env.SESSION_SECRET is missing.
// Callers must fail closed (500) on this — never fall back to an unsigned
// or constant key.
export class MissingSecretError extends Error {
  constructor() {
    super("missing SESSION_SECRET binding");
  }
}

function requireSecret(env: Env): string {
  if (!env.SESSION_SECRET) throw new MissingSecretError();
  return env.SESSION_SECRET;
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function sign(payload: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64urlEncode(new Uint8Array(signature));
}

// Uses crypto.subtle.verify (constant-time), never string equality, so
// timing does not leak how much of the signature matched.
export async function verify(payload: string, signature: string, secret: string): Promise<boolean> {
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64urlDecode(signature);
  } catch {
    return false;
  }
  const key = await importHmacKey(secret);
  return crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(payload));
}

function encodeSession(session: Session): string {
  return base64urlEncode(new TextEncoder().encode(JSON.stringify(session)));
}

function decodeSession(encoded: string): Session | null {
  try {
    const json = new TextDecoder().decode(base64urlDecode(encoded));
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Session).pid === "string" &&
      typeof (parsed as Session).nick === "string" &&
      typeof (parsed as Session).iat === "number" &&
      ["number", "undefined"].includes(typeof (parsed as Session).ep) &&
      ["string", "undefined"].includes(typeof (parsed as Session).sid)
    ) {
      return parsed as Session;
    }
    return null;
  } catch {
    return null;
  }
}

// Cookie value shape: <base64url(JSON{ pid, nick, iat })>.<base64url(sig)>
function splitCookie(raw: string): { payload: string; signature: string } | null {
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;
  return { payload: raw.slice(0, dot), signature: raw.slice(dot + 1) };
}

// Only requires the secret when there is actually a cookie to verify, so
// routes that need no identity (e.g. /api/health, /api/games) keep working
// even if SESSION_SECRET is not configured; anything that *does* have a
// cookie still fails closed rather than silently treating it as "logged
// out".
export async function readSession(c: Context<SessionBindings>): Promise<Session | null> {
  const raw = getCookie(c, SESSION_COOKIE);
  if (!raw) return null;
  const split = splitCookie(raw);
  if (!split) return null;
  const secret = requireSecret(c.env);
  const ok = await verify(split.payload, split.signature, secret);
  if (!ok) return null;
  return decodeSession(split.payload);
}

export async function writeSession(c: Context<SessionBindings>, session: Session): Promise<void> {
  const secret = requireSecret(c.env);
  const payload = encodeSession(session);
  const signature = await sign(payload, secret);
  const secure = new URL(c.req.url).protocol === "https:";
  setCookie(c, SESSION_COOKIE, `${payload}.${signature}`, {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    maxAge: 31536000, // seconds; ~1 year
    secure, // so local http dev keeps working
  });
}

// Signs the caller out by dropping the cookie. There is no session store to
// revoke against — the cookie *is* the session — so this is the whole of
// it. The path must match writeSession's, or the browser keeps the old one.
export function clearSession(c: Context<SessionBindings>): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  c.set("session", null);
}

// The epoch a player's sessions must carry, or null when the registry has no
// row for them. A missing row is not a revocation: GET /api/me registers a
// session the registry lacks.
async function currentEpoch(db: D1Database, playerId: string): Promise<number | null> {
  const row = await db
    .prepare("SELECT session_epoch AS epoch FROM players WHERE id = ?")
    .bind(playerId)
    .first<{ epoch: number }>();
  return row ? row.epoch : null;
}

// Parses the session cookie (if any) and puts it on the context. Does not
// itself require a session — see requireSession for that. A cookie from
// before the player's last "sign out everywhere" is dropped here, which is
// what signs every other device out: it costs each signed-in request one
// read of the registry.
export function sessionMiddleware(): MiddlewareHandler<SessionBindings> {
  return async (c, next) => {
    try {
      let session = await readSession(c);
      if (session) {
        const epoch = await currentEpoch(c.env.DB, session.pid);
        if (epoch !== null && epoch !== (session.ep ?? 0)) {
          deleteCookie(c, SESSION_COOKIE, { path: "/" });
          session = null;
        }
      }
      c.set("session", session);
    } catch (err) {
      if (err instanceof MissingSecretError) {
        return c.json({ error: "missing_binding", binding: "SESSION_SECRET" }, 500);
      }
      throw err;
    }
    await next();
  };
}

export function requireSession(): MiddlewareHandler<SessionBindings> {
  return async (c, next) => {
    if (!c.get("session")) {
      return c.json({ error: "no_identity" }, 401);
    }
    await next();
  };
}

// A WebAuthn ceremony's challenge, between the request that hands out its
// options and the one that answers them. Kept in a signed cookie of its own,
// so the Worker stays without a session store: the browser hands back the
// challenge it was given, and the signature proves the Worker gave it.
export const CHALLENGE_COOKIE = "party_webauthn";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export type ChallengePurpose = "register" | "signin";

interface Challenge {
  challenge: string;
  purpose: ChallengePurpose;
  pid: string; // whose passkey is being made, or signed in with
  exp: number;
}

export async function writeChallenge(
  c: Context<SessionBindings>,
  value: Omit<Challenge, "exp">,
): Promise<void> {
  const secret = requireSecret(c.env);
  const payload = base64urlEncode(
    new TextEncoder().encode(JSON.stringify({ ...value, exp: Date.now() + CHALLENGE_TTL_MS })),
  );
  setCookie(c, CHALLENGE_COOKIE, `${payload}.${await sign(payload, secret)}`, {
    httpOnly: true,
    path: "/api",
    sameSite: "Strict",
    maxAge: CHALLENGE_TTL_MS / 1000,
    secure: new URL(c.req.url).protocol === "https:",
  });
}

// The challenge for `purpose`, if one was handed out to this browser and has
// not expired. Reading it drops the cookie: a challenge answers one ceremony.
export async function takeChallenge(
  c: Context<SessionBindings>,
  purpose: ChallengePurpose,
): Promise<{ challenge: string; pid: string } | null> {
  const raw = getCookie(c, CHALLENGE_COOKIE);
  if (!raw) return null;
  deleteCookie(c, CHALLENGE_COOKIE, { path: "/api" });
  const split = splitCookie(raw);
  if (!split) return null;
  if (!(await verify(split.payload, split.signature, requireSecret(c.env)))) return null;
  try {
    const value = JSON.parse(
      new TextDecoder().decode(base64urlDecode(split.payload)),
    ) as Partial<Challenge>;
    if (
      value.purpose !== purpose ||
      typeof value.challenge !== "string" ||
      typeof value.pid !== "string" ||
      typeof value.exp !== "number" ||
      value.exp < Date.now()
    ) {
      return null;
    }
    return { challenge: value.challenge, pid: value.pid };
  } catch {
    return null;
  }
}
