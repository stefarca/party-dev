import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";

// Nickname + HMAC-signed cookie. No
// passwords, no KV/D1 session store — the cookie itself is the session,
// authenticated with Web Crypto HMAC-SHA256 and a secret held in
// env.SESSION_SECRET (a Worker secret, never committed).

export const SESSION_COOKIE = "party_session";

export interface Session {
  pid: string; // playerId — crypto.randomUUID(), minted once, preserved across nickname changes
  nick: string;
  iat: number; // epoch ms the session was first minted
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
      typeof (parsed as Session).iat === "number"
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

// Parses the session cookie (if any) and puts it on the context. Does not
// itself require a session — see requireSession for that.
export function sessionMiddleware(): MiddlewareHandler<SessionBindings> {
  return async (c, next) => {
    try {
      c.set("session", await readSession(c));
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
