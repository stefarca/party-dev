import { readdirSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { decodeBase64Url, encodeBase64Url } from "../shared/base64url";
import { createMigratedDb } from "./__fixtures__/d1";
import {
  COPY,
  composeNudge,
  encryptPayload,
  forgetSubscription,
  pushPublicKey,
  saveSubscription,
  sendPush,
  sendPushNudges,
  subscriptionsFor,
  vapidAuthorization,
} from "./push";

// Web push is the one thing in this repo that cannot be checked by reading
// it: a payload the Worker encrypts wrongly is indistinguishable from one it
// encrypts rightly until a real push service and a real browser disagree
// with it, at which point the only symptom is a notification nobody gets.
//
// So the two halves of the protocol are verified against the standard rather
// than against this file's own helpers: the VAPID header is verified with
// Web Crypto as a push service would verify it, and the encrypted body is
// decrypted here by re-deriving RFC 8291's key schedule independently (the
// functions below are a second implementation, deliberately not shared with
// worker/push.ts — a shared bug would cancel out and the test would pass).

const utf8 = (value: string) => new TextEncoder().encode(value);

// workerd's generated types have `exportKey` returning either bytes or a JWK,
// since only the call site knows which format was asked for.
async function exportRaw(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array((await crypto.subtle.exportKey("raw", key)) as ArrayBuffer);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8),
  );
}

// A stand-in for one browser's subscription: a real P-256 key pair whose
// private half stays here, exactly as a browser keeps its own.
async function fakeSubscription(endpoint = "https://push.example.test/a/b") {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  return {
    endpoint,
    p256dh: encodeBase64Url(await exportRaw(pair.publicKey)),
    auth: encodeBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    privateKey: pair.privateKey,
  };
}

// RFC 8188's `aes128gcm` body, read the way a browser reads it.
async function decryptBody(
  subscription: Awaited<ReturnType<typeof fakeSubscription>>,
  body: Uint8Array,
): Promise<string> {
  const salt = body.subarray(0, 16);
  const keyLength = body[20];
  const serverPublic = body.subarray(21, 21 + keyLength);
  const ciphertext = body.subarray(21 + keyLength);

  const serverKey = await crypto.subtle.importKey(
    "raw",
    serverPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  // `public` is the parameter's real name; workerd's generated types escape
  // it to `$public` because it is a TypeScript keyword (see worker/push.ts).
  const ecdh = { name: "ECDH", public: serverKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, subscription.privateKey, 256));
  const ikm = await hkdf(
    shared,
    decodeBase64Url(subscription.auth),
    concat(utf8("WebPush: info\0"), decodeBase64Url(subscription.p256dh), serverPublic),
    32,
  );
  const salted = new Uint8Array(salt);
  const key = await crypto.subtle.importKey(
    "raw",
    await hkdf(ikm, salted, utf8("Content-Encoding: aes128gcm\0"), 16),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const iv = await hkdf(ikm, salted, utf8("Content-Encoding: nonce\0"), 12);
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext),
  );
  // The last byte is RFC 8188's record delimiter, not payload.
  return new TextDecoder().decode(plaintext.subarray(0, plaintext.length - 1));
}

async function vapidConfig() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  return {
    publicKey: encodeBase64Url(await exportRaw(pair.publicKey)),
    privateKey: jwk.d!,
    subject: "mailto:party@example.test",
  };
}

function envWith(config: Awaited<ReturnType<typeof vapidConfig>> | null, db?: D1Database): Env {
  return {
    DB: db,
    ...(config
      ? {
          VAPID_PUBLIC_KEY: config.publicKey,
          VAPID_PRIVATE_KEY: config.privateKey,
          VAPID_SUBJECT: config.subject,
        }
      : {}),
  } as unknown as Env;
}

describe("configuration", () => {
  it("reports no key until all three secrets are set", async () => {
    const config = await vapidConfig();
    expect(pushPublicKey(envWith(null))).toBeNull();
    expect(pushPublicKey({ VAPID_PUBLIC_KEY: config.publicKey } as unknown as Env)).toBeNull();
    expect(pushPublicKey(envWith(config))).toBe(config.publicKey);
  });
});

describe("wording", () => {
  // A language the app speaks but this file does not would silently notify
  // its speakers in English. Nothing else links the two sets.
  it("covers every language web/locales ships", () => {
    const languages = readdirSync("web/locales")
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.replace(/\.json$/, ""));
    expect(Object.keys(COPY).sort()).toEqual(languages.sort());
  });

  it("names the game the way the app does, in the device's language", () => {
    const english = composeNudge("en", { matchId: "ABCDEF", gameId: "connect4" });
    expect(english.title).toBe("Your turn in Connect 4");
    expect(english.body).toContain("ABCDEF");

    // The same game, from the same locale files the client reads.
    const italian = composeNudge("it", { matchId: "ABCDEF", gameId: "connect4" });
    expect(italian.title).toBe("Tocca a te in Forza 4");
  });

  it("falls back to English for a language it has no copy for, and for none at all", () => {
    const english = composeNudge("en", { matchId: "ABCDEF", gameId: "connect4" });
    expect(composeNudge("de", { matchId: "ABCDEF", gameId: "connect4" })).toEqual(english);
    expect(composeNudge(null, { matchId: "ABCDEF", gameId: "connect4" })).toEqual(english);
  });

  it("links to a path, so a misconfigured base URL cannot redirect a player elsewhere", () => {
    expect(composeNudge("en", { matchId: "ABCDEF", gameId: "connect4" }).url).toBe("/m/ABCDEF");
  });

  it("tags on the match, so a second nudge replaces the first", () => {
    const first = composeNudge("en", { matchId: "ABCDEF", gameId: "connect4" });
    const second = composeNudge("en", { matchId: "ABCDEF", gameId: "trivia" });
    expect(second.tag).toBe(first.tag);
  });
});

describe("VAPID", () => {
  const NOW = 1_700_000_000_000;

  it("signs a token a push service can verify with the public key", async () => {
    const config = await vapidConfig();
    const header = await vapidAuthorization(config, "https://push.example.test/a/b?x=1", NOW);

    const match = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/.exec(header);
    expect(match, header).not.toBeNull();
    const [, token, key] = match!;
    expect(key).toBe(config.publicKey);

    const [encodedHeader, encodedClaims, signature] = token.split(".");
    expect(JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedHeader)))).toEqual({
      typ: "JWT",
      alg: "ES256",
    });

    const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedClaims))) as {
      aud: string;
      exp: number;
      sub: string;
    };
    // The audience is the origin alone: the rest of an endpoint is the
    // subscription, and a secret.
    expect(claims.aud).toBe("https://push.example.test");
    expect(claims.sub).toBe(config.subject);
    expect(claims.exp).toBeGreaterThan(Math.floor(NOW / 1000));
    // RFC 8292 refuses anything more than a day out.
    expect(claims.exp).toBeLessThanOrEqual(Math.floor(NOW / 1000) + 24 * 60 * 60);

    const verifier = await crypto.subtle.importKey(
      "raw",
      decodeBase64Url(config.publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      verifier,
      decodeBase64Url(signature),
      utf8(`${encodedHeader}.${encodedClaims}`),
    );
    expect(verified).toBe(true);
  });

  it("refuses a key pair that is not P-256", async () => {
    const config = await vapidConfig();
    await expect(
      vapidAuthorization({ ...config, privateKey: "c2hvcnQ" }, "https://push.example.test/a"),
    ).rejects.toThrow(/32-byte/);
    await expect(
      vapidAuthorization({ ...config, publicKey: "c2hvcnQ" }, "https://push.example.test/a"),
    ).rejects.toThrow(/uncompressed/);
  });
});

describe("payload encryption", () => {
  it("produces a body the subscribed browser can decrypt", async () => {
    const subscription = await fakeSubscription();
    const message = JSON.stringify({ title: "Your turn in Connect 4", body: "ABCDEF" });
    const body = await encryptPayload(subscription, utf8(message));
    expect(await decryptBody(subscription, body)).toBe(message);
  });

  it("writes the header RFC 8188 describes", async () => {
    const subscription = await fakeSubscription();
    const body = await encryptPayload(subscription, utf8("hi"));
    // salt(16) || record size(4) || key length(1) || key(65), then the record.
    expect(new DataView(body.buffer, body.byteOffset).getUint32(16)).toBe(4096);
    expect(body[20]).toBe(65);
    expect(body.subarray(21, 22)[0]).toBe(0x04); // uncompressed point
    // One AES-GCM tag over "hi" plus the record delimiter.
    expect(body.length).toBe(86 + 3 + 16);
  });

  it("cannot be read by any device but the one it was addressed to", async () => {
    const addressee = await fakeSubscription();
    const eavesdropper = await fakeSubscription();
    const body = await encryptPayload(addressee, utf8("hi"));
    await expect(decryptBody(eavesdropper, body)).rejects.toThrow();
  });

  it("never reuses a key or a salt between two messages to the same device", async () => {
    const subscription = await fakeSubscription();
    const first = await encryptPayload(subscription, utf8("hi"));
    const second = await encryptPayload(subscription, utf8("hi"));
    expect([...first.subarray(0, 86)]).not.toEqual([...second.subarray(0, 86)]);
  });

  it("refuses a payload too big for one record", async () => {
    const subscription = await fakeSubscription();
    await expect(encryptPayload(subscription, new Uint8Array(4096))).rejects.toThrow(/one record/);
  });
});

describe("sendPush", () => {
  it("posts an encrypted body with the headers a push service requires", async () => {
    const config = await vapidConfig();
    const subscription = await fakeSubscription("https://push.example.test/device-1");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 201 }));

    const message = composeNudge("en", { matchId: "ABCDEF", gameId: "connect4" });
    expect(await sendPush(config, subscription, message)).toBe("sent");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(subscription.endpoint);
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("content-encoding")).toBe("aes128gcm");
    expect(headers.get("authorization")).toMatch(/^vapid t=/);
    expect(Number(headers.get("ttl"))).toBeGreaterThan(0);
    expect(headers.get("topic")).toBe(message.tag);

    // The body is this exact notification, and only this device can read it.
    expect(JSON.parse(await decryptBody(subscription, init?.body as Uint8Array))).toEqual(message);
    fetchSpy.mockRestore();
  });

  it("reports a retired subscription as gone, and a bad day as failed", async () => {
    const config = await vapidConfig();
    const subscription = await fakeSubscription();
    const message = composeNudge("en", { matchId: "ABCDEF", gameId: "connect4" });

    for (const [status, outcome] of [
      [404, "gone"],
      [410, "gone"],
      [429, "failed"],
      [500, "failed"],
    ] as const) {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status }));
      expect(await sendPush(config, subscription, message), `HTTP ${status}`).toBe(outcome);
      fetchSpy.mockRestore();
    }
  });

  it("never throws when the push service is unreachable", async () => {
    const config = await vapidConfig();
    const subscription = await fakeSubscription();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(
      sendPush(config, subscription, composeNudge("en", { matchId: "A", gameId: "connect4" })),
    ).resolves.toBe("failed");
    fetchSpy.mockRestore();
  });
});

describe("the subscription registry", () => {
  const device = { endpoint: "https://push.example.test/d1", p256dh: "cHVi", auth: "YXV0aA" };

  it("keeps one row per device, moving it to whoever signed in last", async () => {
    const db = createMigratedDb();
    await saveSubscription(db, "alice", device, "en");
    await saveSubscription(db, "bob", device, "it");

    expect(await subscriptionsFor(db, ["alice"])).toEqual([]);
    expect(await subscriptionsFor(db, ["bob"])).toEqual([
      { ...device, playerId: "bob", language: "it" },
    ]);
  });

  it("keeps the stored language when a caller sends none", async () => {
    const db = createMigratedDb();
    await saveSubscription(db, "alice", device, "it");
    await saveSubscription(db, "alice", device, null);
    expect((await subscriptionsFor(db, ["alice"]))[0].language).toBe("it");
  });

  it("drops the endpoint a rotated subscription replaces", async () => {
    const db = createMigratedDb();
    await saveSubscription(db, "alice", device, "en");
    const rotated = { ...device, endpoint: "https://push.example.test/d2" };
    await saveSubscription(db, "alice", rotated, null, device.endpoint);

    const rows = await subscriptionsFor(db, ["alice"]);
    expect(rows.map((row) => row.endpoint)).toEqual([rotated.endpoint]);
  });

  it("finds every device of every player asked about, in one go", async () => {
    const db = createMigratedDb();
    await saveSubscription(db, "alice", device, "en");
    await saveSubscription(db, "alice", { ...device, endpoint: "https://p.example.test/2" }, "en");
    await saveSubscription(db, "bob", { ...device, endpoint: "https://p.example.test/3" }, "en");
    await saveSubscription(db, "carol", { ...device, endpoint: "https://p.example.test/4" }, "en");

    const rows = await subscriptionsFor(db, ["alice", "bob"]);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.playerId))).toEqual(new Set(["alice", "bob"]));
    expect(await subscriptionsFor(db, [])).toEqual([]);
  });

  it("only lets a player forget a device of their own", async () => {
    const db = createMigratedDb();
    await saveSubscription(db, "alice", device, "en");

    await forgetSubscription(db, "bob", device.endpoint);
    expect(await subscriptionsFor(db, ["alice"])).toHaveLength(1);

    await forgetSubscription(db, "alice", device.endpoint);
    expect(await subscriptionsFor(db, ["alice"])).toEqual([]);
  });
});

describe("sendPushNudges", () => {
  it("sends nothing, and reads nothing, without VAPID secrets", async () => {
    const db = createMigratedDb();
    await saveSubscription(db, "alice", await fakeSubscription(), "en");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      sendPushNudges(envWith(null, db), {
        matchId: "ABCDEF",
        gameId: "connect4",
        playerIds: ["alice"],
      }),
    ).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("notifies every device of every waiting player, each in its own language", async () => {
    const config = await vapidConfig();
    const db = createMigratedDb();
    const phone = await fakeSubscription("https://push.example.test/phone");
    const laptop = await fakeSubscription("https://push.example.test/laptop");
    await saveSubscription(db, "alice", phone, "it");
    await saveSubscription(db, "alice", laptop, "en");
    await saveSubscription(db, "carol", await fakeSubscription("https://p.example.test/c"), "en");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 201 }));
    await sendPushNudges(envWith(config, db), {
      matchId: "ABCDEF",
      gameId: "connect4",
      playerIds: ["alice"],
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const byEndpoint = new Map(
      fetchSpy.mock.calls.map(([url, init]) => [url as string, init?.body as Uint8Array]),
    );
    const onPhone = JSON.parse(await decryptBody(phone, byEndpoint.get(phone.endpoint)!)) as {
      title: string;
    };
    const onLaptop = JSON.parse(await decryptBody(laptop, byEndpoint.get(laptop.endpoint)!)) as {
      title: string;
    };
    expect(onPhone.title).toBe("Tocca a te in Forza 4");
    expect(onLaptop.title).toBe("Your turn in Connect 4");
    fetchSpy.mockRestore();
  });

  it("forgets a subscription its push service says is gone, and keeps one that merely failed", async () => {
    const config = await vapidConfig();
    const db = createMigratedDb();
    const dead = await fakeSubscription("https://push.example.test/dead");
    const flaky = await fakeSubscription("https://push.example.test/flaky");
    await saveSubscription(db, "alice", dead, "en");
    await saveSubscription(db, "alice", flaky, "en");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) =>
        Promise.resolve(new Response(null, { status: String(input).includes("dead") ? 410 : 503 })),
      );
    await sendPushNudges(envWith(config, db), {
      matchId: "ABCDEF",
      gameId: "connect4",
      playerIds: ["alice"],
    });

    const left = await subscriptionsFor(db, ["alice"]);
    expect(left.map((row) => row.endpoint)).toEqual([flaky.endpoint]);
    fetchSpy.mockRestore();
  });

  it("never throws when D1 is down", async () => {
    const config = await vapidConfig();
    const broken = {
      prepare() {
        throw new Error("D1 unavailable");
      },
    } as unknown as D1Database;
    await expect(
      sendPushNudges(envWith(config, broken), {
        matchId: "ABCDEF",
        gameId: "connect4",
        playerIds: ["alice"],
      }),
    ).resolves.toBeUndefined();
  });
});
