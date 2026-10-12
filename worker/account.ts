import { Hono } from "hono";
import type { Context } from "hono";

import {
  IdentityRequestSchema,
  PasskeyOptionsRequestSchema,
  PasskeyResponseSchema,
  PinSignInRequestSchema,
  SetPinRequestSchema,
  SignInPollRequestSchema,
  SignOutEverywhereRequestSchema,
} from "../shared/protocol";
import type {
  SecurityState,
  SignInChallenge,
  SignInMethod,
  SignInNotices,
  SignInPollResponse,
} from "../shared/protocol";
import type { Session, SessionBindings } from "./auth";
import { requireSession, takeChallenge, writeChallenge, writeSession } from "./auth";
import {
  addPasskey,
  authenticationOptions,
  checkPasskey,
  checkPin,
  isLocked,
  registrationOptions,
  relyingParty,
  removePasskeys,
  removePin,
  securityState,
  setPin,
} from "./lock";
import {
  NicknameTakenError,
  claimNickname,
  findPlayerById,
  findPlayerByNickname,
  renamePlayer,
  sessionEpoch,
  signIn,
  touchPlayer,
} from "./players";
import type { PlayerRecord } from "./players";
import { sendAccountNotice } from "./push";
import type { AccountNoticeKind } from "./push";
import {
  AUTO_ALLOW_MS,
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

// Identity and everything that keeps a nickname to its owner: signing in,
// renaming, the approval of a sign-in by a device already signed in, the
// optional PIN and passkeys, and signing every other device out.
//
// The rule it all serves is that the first visit stays one field and one
// button. A nickname nobody holds is claimed by typing it. Only typing one
// somebody already holds meets anything more, and how much depends on the
// owner:
//
//  - no device that could answer (none with the app open lately, none taking
//    notifications): in at once, as before, and the owner's devices list the
//    sign-in the next time one opens the app.
//  - a device that could answer: the owner is asked, and the sign-in goes
//    through on their "allow", or by itself after `AUTO_ALLOW_MS` unless they
//    say no — so a lost phone never locks anyone out of an unlocked name.
//  - a locked name (a PIN or a passkey): only the PIN, a passkey or the
//    owner's approval let the device in. Nothing goes through by itself.
//
// Every sign-in to a held name is recorded (`sign_ins`), and every one the
// owner did not approve is listed on their devices with a "sign out
// everywhere" beside it.
export const account = new Hono<SessionBindings>();

async function readJsonBody(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// Work that outlives the response, like a notification. Outside a Worker (in
// the tests) there is no execution context, and the promise just runs.
function background(c: Context<SessionBindings>, work: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    void work.catch(() => {});
  }
}

function notify(
  c: Context<SessionBindings>,
  player: PlayerRecord,
  kind: AccountNoticeKind,
  device: string,
): void {
  background(c, sendAccountNotice(c.env, player.id, { kind, device, nickname: player.nickname }));
}

interface Me {
  playerId: string;
  nickname: string;
}

// Issues this device a session as `player`, under the player's current
// epoch. `sid` is the sign-in that let it in, when there was one. The cookie
// rides on whatever reply the caller then sends.
async function startSession(
  c: Context<SessionBindings>,
  player: PlayerRecord,
  sid?: string,
): Promise<Me> {
  const session: Session = {
    pid: player.id,
    nick: player.nickname,
    iat: Date.now(),
    ep: await sessionEpoch(c.env.DB, player.id),
    ...(sid ? { sid } : {}),
  };
  await writeSession(c, session);
  return { playerId: session.pid, nickname: session.nick };
}

// A sign-in that went through without the owner's say: recorded for the
// owner's devices to list, and announced to the ones that take
// notifications. The owner's own approval needs neither.
async function signInAs(
  c: Context<SessionBindings>,
  player: PlayerRecord,
  method: SignInMethod,
  device: string,
): Promise<Response> {
  const sid = await recordSignIn(c.env.DB, {
    playerId: player.id,
    device,
    method,
    now: Date.now(),
  });
  notify(c, player, "signedIn", device);
  return c.json<Me>(await startSession(c, player, sid));
}

// Sign in, and rename. Which one it is depends on whether the caller
// already has a session:
//
//  - no session: a free nickname is claimed on the spot. A held one is
//    signed into as the header above describes, so the reply may be a 409
//    (`SignInChallenge`) that the gate turns into "approve it on your other
//    device" or "enter your PIN". An app from before this existed shows that
//    as a plain sign-in failure, which is the safe way for it to go wrong.
//  - a session: you keep your player id and move it onto the new nickname,
//    so nothing you have played is left behind. A nickname somebody else
//    holds is refused rather than silently switching you into their
//    account; signing out first is the way to do that on purpose.
account.post("/identity", async (c) => {
  const parsed = IdentityRequestSchema.safeParse(await readJsonBody(c.req.raw));
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const { nickname } = parsed.data;

  const existing = c.get("session");
  if (existing) {
    let player;
    try {
      player = await renamePlayer(c.env.DB, existing.pid, nickname);
    } catch (err) {
      if (err instanceof NicknameTakenError) {
        return c.json({ error: "nickname_taken" }, 409);
      }
      throw err;
    }
    const session: Session = { ...existing, nick: player.nickname };
    await writeSession(c, session);
    return c.json({ playerId: session.pid, nickname: session.nick });
  }

  const db = c.env.DB;
  const now = Date.now();
  const { claimed, player } = await claimNickname(db, nickname);
  if (claimed) return c.json<Me>(await startSession(c, player));

  const device = deviceLabel(c.req.header("User-Agent"));
  const [lock, approvable] = await Promise.all([
    securityState(db, player.id),
    canApprove(db, player.id, now),
  ]);
  const locked = isLocked(lock);

  if (!locked && !approvable) {
    // Nobody to ask: the old way, keeping the spelling just typed.
    return signInAs(c, await signIn(db, nickname), "open", device);
  }

  let request = null;
  try {
    request = await openRequest(db, {
      playerId: player.id,
      device,
      now,
      autoAt: locked ? null : now + AUTO_ALLOW_MS,
    });
  } catch (err) {
    if (!(err instanceof TooManyRequestsError)) throw err;
    // A locked name can still be opened with its PIN or passkey.
    if (!locked) return c.json({ error: "too_many_requests" }, 429);
  }
  if (request) notify(c, player, "signInRequest", device);

  return c.json<SignInChallenge>(
    {
      error: locked ? "nickname_locked" : "approval_required",
      nickname: player.nickname,
      request,
      methods: { pin: lock.pin, passkey: lock.passkeys > 0 },
    },
    409,
  );
});

// Where a sign-in request stands, asked every few seconds by the device that
// made it. Once it goes through, this reply carries the session.
account.post("/identity/requests/:id", async (c) => {
  const parsed = SignInPollRequestSchema.safeParse(await readJsonBody(c.req.raw));
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const result = await pollRequest(c.env.DB, c.req.param("id"), parsed.data.secret, Date.now());
  if (result.status !== "ready") return c.json<SignInPollResponse>(result);

  const player = await findPlayerById(c.env.DB, result.playerId);
  if (!player) return c.json<SignInPollResponse>({ status: "expired" });
  // A request that went through on the clock is one the owner never saw
  // answered, so their devices are told; one they approved, they know about.
  if (result.method === "auto") {
    notify(c, player, "signedIn", deviceLabel(c.req.header("User-Agent")));
  }
  const me = await startSession(c, player, c.req.param("id"));
  return c.json<SignInPollResponse>({ status: "signedIn", ...me });
});

// Signs in with the owner's PIN. Every wrong guess counts towards a block,
// and a nickname nobody holds, or one without a PIN, answers exactly like a
// wrong PIN, so a guess learns nothing about which it was.
account.post("/identity/pin", async (c) => {
  const parsed = PinSignInRequestSchema.safeParse(await readJsonBody(c.req.raw));
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const player = await findPlayerByNickname(c.env.DB, parsed.data.nickname);
  if (!player) return c.json({ error: "wrong_pin" }, 401);
  const check = await checkPin(
    c.env.DB,
    c.env.SESSION_SECRET,
    player.id,
    parsed.data.pin,
    Date.now(),
  );
  if (!check.ok) {
    if (check.reason === "blocked") {
      return c.json({ error: "pin_blocked", retryAt: check.retryAt }, 429);
    }
    return c.json({ error: "wrong_pin" }, 401);
  }
  return signInAs(c, player, "pin", deviceLabel(c.req.header("User-Agent")));
});

// The first half of signing in with a passkey: the options for the browser,
// naming the owner's passkeys, with the challenge kept in a signed cookie.
account.post("/identity/passkey/options", async (c) => {
  const parsed = PasskeyOptionsRequestSchema.safeParse(await readJsonBody(c.req.raw));
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const player = await findPlayerByNickname(c.env.DB, parsed.data.nickname);
  const options = player
    ? await authenticationOptions(c.env.DB, relyingParty(c.req.url), player.id)
    : null;
  if (!player || !options) return c.json({ error: "no_passkey" }, 404);
  await writeChallenge(c, { challenge: options.challenge, purpose: "signin", pid: player.id });
  return c.json(options);
});

account.post("/identity/passkey", async (c) => {
  const parsed = PasskeyResponseSchema.safeParse(await readJsonBody(c.req.raw));
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const challenge = await takeChallenge(c, "signin");
  const player = challenge ? await findPlayerById(c.env.DB, challenge.pid) : null;
  if (
    !challenge ||
    !player ||
    !(await checkPasskey(
      c.env.DB,
      relyingParty(c.req.url),
      player.id,
      challenge.challenge,
      parsed.data.response as unknown as Parameters<typeof checkPasskey>[4],
      Date.now(),
    ))
  ) {
    return c.json({ error: "passkey_failed" }, 401);
  }
  return signInAs(c, player, "passkey", deviceLabel(c.req.header("User-Agent")));
});

// ---------------------------------------------------------------------
// The signed-in player's side
// ---------------------------------------------------------------------

// Asked every few seconds by every open page, which is also how the registry
// knows the player has a device that could answer a sign-in.
account.get("/me/sign-ins", requireSession(), async (c) => {
  const session = c.get("session") as Session;
  const now = Date.now();
  const [notices] = await Promise.all([
    signInNotices(c.env.DB, session.pid, session.sid, now),
    touchPlayer(c.env.DB, session.pid, now),
  ]);
  return c.json<SignInNotices>(notices);
});

account.post("/me/sign-ins/:id/:answer{approve|deny|ack}", requireSession(), async (c) => {
  const session = c.get("session") as Session;
  const id = c.req.param("id");
  const answer = c.req.param("answer");
  const now = Date.now();
  if (answer === "ack") {
    await acknowledgeSignIn(c.env.DB, session.pid, id, now);
    return c.json({ ok: true });
  }
  if (!(await decideRequest(c.env.DB, session.pid, id, answer === "approve", now))) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json({ ok: true });
});

// Every other device stops being signed in as this player on its next
// request, and stops getting their notifications. This device gets a fresh
// cookie under the new epoch, so it stays.
account.post("/me/sign-out-everywhere", requireSession(), async (c) => {
  const parsed = SignOutEverywhereRequestSchema.safeParse(await readJsonBody(c.req.raw));
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const session = c.get("session") as Session;
  const ep = await signOutEverywhere(c.env.DB, session.pid, parsed.data.keepEndpoint, Date.now());
  await writeSession(c, { ...session, ep });
  return c.json({ ok: true });
});

account.get("/me/security", requireSession(), async (c) => {
  const session = c.get("session") as Session;
  return c.json<SecurityState>(await securityState(c.env.DB, session.pid));
});

account.post("/me/pin", requireSession(), async (c) => {
  const parsed = SetPinRequestSchema.safeParse(await readJsonBody(c.req.raw));
  if (!parsed.success) {
    return c.json({ error: "invalid_pin" }, 400);
  }
  const session = c.get("session") as Session;
  if (!(await setPin(c.env.DB, c.env.SESSION_SECRET, session.pid, parsed.data.pin, Date.now()))) {
    return c.json({ error: "no_identity" }, 401);
  }
  return c.json<SecurityState>(await securityState(c.env.DB, session.pid));
});

account.post("/me/pin/remove", requireSession(), async (c) => {
  const session = c.get("session") as Session;
  await removePin(c.env.DB, session.pid);
  return c.json<SecurityState>(await securityState(c.env.DB, session.pid));
});

account.post("/me/passkeys/options", requireSession(), async (c) => {
  const session = c.get("session") as Session;
  const player = await findPlayerById(c.env.DB, session.pid);
  if (!player) return c.json({ error: "no_identity" }, 401);
  const options = await registrationOptions(c.env.DB, relyingParty(c.req.url), player);
  await writeChallenge(c, { challenge: options.challenge, purpose: "register", pid: player.id });
  return c.json(options);
});

account.post("/me/passkeys", requireSession(), async (c) => {
  const parsed = PasskeyResponseSchema.safeParse(await readJsonBody(c.req.raw));
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const session = c.get("session") as Session;
  const challenge = await takeChallenge(c, "register");
  if (
    !challenge ||
    challenge.pid !== session.pid ||
    !(await addPasskey(
      c.env.DB,
      relyingParty(c.req.url),
      session.pid,
      challenge.challenge,
      parsed.data.response as unknown as Parameters<typeof addPasskey>[4],
      Date.now(),
    ))
  ) {
    return c.json({ error: "passkey_failed" }, 400);
  }
  return c.json<SecurityState>(await securityState(c.env.DB, session.pid));
});

account.post("/me/passkeys/remove", requireSession(), async (c) => {
  const session = c.get("session") as Session;
  await removePasskeys(c.env.DB, session.pid);
  return c.json<SecurityState>(await securityState(c.env.DB, session.pid));
});
