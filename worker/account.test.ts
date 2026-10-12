import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";

import { encodeBase64Url } from "../shared/base64url";
import type { SignInChallenge, SignInNotices, SignInPollResponse } from "../shared/protocol";
import { createMigratedDb } from "./__fixtures__/d1";
import { account } from "./account";
import type { SessionBindings } from "./auth";
import { SESSION_COOKIE, sessionMiddleware, sign } from "./auth";
import { AUTO_ALLOW_MS } from "./signins";

// The routes end to end, against the real schema: who gets a session for a
// nickname somebody already holds, and when a session stops being one. Each
// "device" is a cookie jar of one session cookie.

const app = new Hono<SessionBindings>();
app.use("*", sessionMiddleware());
app.route("/", account);

let env: Env;

beforeEach(() => {
  env = { DB: createMigratedDb(), SESSION_SECRET: "test-secret" } as unknown as Env;
});

class Device {
  cookie: string | null = null;

  constructor(readonly userAgent = "Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0") {}

  async call(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { "User-Agent": this.userAgent };
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(
      `http://localhost${path}`,
      { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
      env,
    );
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const [name, value] = pair.split("=");
      if (name !== SESSION_COOKIE) continue;
      this.cookie = value ? `${name}=${value}` : null;
    }
    return res;
  }

  signIn(nickname: string) {
    return this.call("POST", "/identity", { nickname });
  }
}

// Makes the owner's devices look away long enough that nobody could answer.
async function ownerAway() {
  await env.DB.prepare("UPDATE players SET last_seen_at = 0").bind().run();
}

describe("signing in", () => {
  it("claims a free nickname on the spot", async () => {
    const phone = new Device();
    const res = await phone.signIn("Ada");
    expect(res.status).toBe(200);
    expect(phone.cookie).not.toBeNull();
    expect((await phone.call("GET", "/me/security")).status).toBe(200);
  });

  it("lets a new device straight in when the owner has no device to ask, and tells the owner", async () => {
    const phone = new Device();
    const ada = (await (await phone.signIn("Ada")).json()) as { playerId: string };
    await ownerAway();

    const laptop = new Device("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1.15");
    const res = await laptop.signIn("ada");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { playerId: string }).playerId).toBe(ada.playerId);

    const notices = (await (await phone.call("GET", "/me/sign-ins")).json()) as SignInNotices;
    expect(notices.recent).toMatchObject([{ device: "Safari on Mac", method: "open" }]);
    // The laptop is not told about its own sign-in.
    const own = (await (await laptop.call("GET", "/me/sign-ins")).json()) as SignInNotices;
    expect(own.recent).toEqual([]);
  });

  it("waits on the owner's approval while they have a device that could give it", async () => {
    const phone = new Device();
    await phone.signIn("Ada");
    const laptop = new Device();

    const res = await laptop.signIn("Ada");
    expect(res.status).toBe(409);
    const challenge = (await res.json()) as SignInChallenge;
    expect(challenge).toMatchObject({
      error: "approval_required",
      nickname: "Ada",
      methods: { pin: false, passkey: false },
    });
    expect(laptop.cookie).toBeNull();
    const request = challenge.request!;
    expect(request.autoAt).not.toBeNull();

    const poll = () =>
      laptop.call("POST", `/identity/requests/${request.id}`, { secret: request.secret });
    expect(((await (await poll()).json()) as SignInPollResponse).status).toBe("pending");

    const notices = (await (await phone.call("GET", "/me/sign-ins")).json()) as SignInNotices;
    expect(notices.pending.map((p) => p.id)).toEqual([request.id]);
    expect((await phone.call("POST", `/me/sign-ins/${request.id}/approve`)).status).toBe(200);

    expect(await (await poll()).json()).toMatchObject({ status: "signedIn", nickname: "Ada" });
    expect(laptop.cookie).not.toBeNull();
    expect((await laptop.call("GET", "/me/security")).status).toBe(200);
    // Approved by the owner, so nothing is left for the owner to worry about.
    expect(await (await phone.call("GET", "/me/sign-ins")).json()).toEqual({
      pending: [],
      recent: [],
    });
  });

  it("keeps out a device the owner denies", async () => {
    const phone = new Device();
    await phone.signIn("Ada");
    const laptop = new Device();
    const { request } = (await (await laptop.signIn("Ada")).json()) as SignInChallenge;

    await phone.call("POST", `/me/sign-ins/${request!.id}/deny`);
    const res = await laptop.call("POST", `/identity/requests/${request!.id}`, {
      secret: request!.secret,
    });
    expect(await res.json()).toEqual({ status: "denied" });
    expect(laptop.cookie).toBeNull();
  });

  it("lets the new device in by itself if the owner never answers", async () => {
    const phone = new Device();
    await phone.signIn("Ada");
    const laptop = new Device();
    const { request } = (await (await laptop.signIn("Ada")).json()) as SignInChallenge;
    await env.DB.prepare("UPDATE sign_ins SET auto_at = ? WHERE id = ?")
      .bind(Date.now() - 1, request!.id)
      .run();

    const res = await laptop.call("POST", `/identity/requests/${request!.id}`, {
      secret: request!.secret,
    });
    expect(await res.json()).toMatchObject({ status: "signedIn" });
    // ...and the owner hears about it.
    const notices = (await (await phone.call("GET", "/me/sign-ins")).json()) as SignInNotices;
    expect(notices.recent).toMatchObject([{ method: "auto" }]);
    expect(request!.autoAt! - Date.now()).toBeLessThanOrEqual(AUTO_ALLOW_MS);
  });
});

describe("a locked nickname", () => {
  it("lets nobody in without its PIN, its passkey or the owner, even with no device to ask", async () => {
    const phone = new Device();
    await phone.signIn("Ada");
    expect((await phone.call("POST", "/me/pin", { pin: "2468" })).status).toBe(200);
    await ownerAway();

    const laptop = new Device();
    const res = await laptop.signIn("Ada");
    expect(res.status).toBe(409);
    const challenge = (await res.json()) as SignInChallenge;
    expect(challenge).toMatchObject({
      error: "nickname_locked",
      methods: { pin: true, passkey: false },
    });
    // A request still waits, in case the owner opens the app, but never goes through alone.
    expect(challenge.request?.autoAt).toBeNull();

    expect(
      (await laptop.call("POST", "/identity/pin", { nickname: "Ada", pin: "1111" })).status,
    ).toBe(401);
    expect(laptop.cookie).toBeNull();
    // Unknown nicknames answer like a wrong PIN.
    expect(
      await (
        await laptop.call("POST", "/identity/pin", { nickname: "Nobody", pin: "1111" })
      ).json(),
    ).toEqual({ error: "wrong_pin" });

    const ok = await laptop.call("POST", "/identity/pin", { nickname: "ada", pin: "2468" });
    expect(ok.status).toBe(200);
    expect(laptop.cookie).not.toBeNull();
  });

  it("asks for a PIN in the right shape", async () => {
    const phone = new Device();
    await phone.signIn("Ada");
    expect(await (await phone.call("POST", "/me/pin", { pin: "12" })).json()).toEqual({
      error: "invalid_pin",
    });
  });

  it("offers no passkey sign-in to a name without one", async () => {
    const phone = new Device();
    await phone.signIn("Ada");
    const res = await new Device().call("POST", "/identity/passkey/options", { nickname: "Ada" });
    expect(res.status).toBe(404);
  });
});

describe("sign out everywhere", () => {
  it("ends every other device's session and keeps this one", async () => {
    const phone = new Device();
    await phone.signIn("Ada");
    await ownerAway();
    const laptop = new Device();
    await laptop.signIn("Ada");
    expect((await laptop.call("GET", "/me/security")).status).toBe(200);

    expect((await phone.call("POST", "/me/sign-out-everywhere", {})).status).toBe(200);

    expect((await phone.call("GET", "/me/security")).status).toBe(200);
    expect((await laptop.call("GET", "/me/security")).status).toBe(401);
    // The dead cookie was dropped, not kept around to be refused again.
    expect(laptop.cookie).toBeNull();
  });

  it("honours a cookie from before epochs existed, until the first sign-out everywhere", async () => {
    const phone = new Device();
    const { playerId } = (await (await phone.signIn("Ada")).json()) as { playerId: string };

    // A cookie as the Worker issued it before epochs: no `ep` at all.
    const legacy = new Device();
    const payload = encodeBase64Url(
      new TextEncoder().encode(JSON.stringify({ pid: playerId, nick: "Ada", iat: 1 })),
    );
    legacy.cookie = `${SESSION_COOKIE}=${payload}.${await sign(payload, "test-secret")}`;
    expect((await legacy.call("GET", "/me/security")).status).toBe(200);

    await phone.call("POST", "/me/sign-out-everywhere", {});
    expect((await legacy.call("GET", "/me/security")).status).toBe(401);
  });
});
