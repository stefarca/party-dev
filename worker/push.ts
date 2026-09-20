import { gameName } from "../games/names";
import { decodeBase64Url, encodeBase64Url } from "../shared/base64url";
import type { PlayerId } from "../shared/protocol";

// Web push nudges: the same "you are up" message worker/nudge.ts posts to
// Slack, delivered instead to the browsers a player has opted in from.
//
// Two standards make that possible without a third-party service, and both
// are implemented here against Web Crypto because the Worker has no npm
// `web-push` available to it:
//
//   - VAPID (RFC 8292) identifies this application to the push service: a
//     short-lived ES256 JWT, signed with the private half of the key pair
//     whose public half every subscription was created with.
//   - Message encryption (RFC 8291 over RFC 8188's `aes128gcm`) means the
//     push service forwards a payload it cannot read. The keys come out of
//     an ECDH between an ephemeral key pair generated per message and the
//     browser's own public key, salted with the subscription's auth secret.
//
// Like the Slack nudge, nothing here may throw at its callers: a send is
// fired from `MatchDO.nudgeHook()` through `ctx.waitUntil()`, and a throw
// reaching `alarm()` would be retried up to six times. Every failure below
// is swallowed after a log line.

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface StoredSubscription extends PushSubscriptionInput {
  playerId: PlayerId;
  language: string | null;
}

// What the service worker is handed. It renders this as-is: the text was
// composed here, in the language the device asked to be notified in.
export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export type PushDelivery = "sent" | "gone" | "failed";

interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

// How long the push service holds an undelivered nudge for a device that is
// off or offline. A turn in an async game keeps for half a day; past that
// the match has almost certainly moved on, and a stale "your turn" is worse
// than no notification at all.
const TTL_SECONDS = 12 * 60 * 60;

// RFC 8292 caps a VAPID token at 24 hours. Half that leaves room for a
// push service whose clock runs ahead of ours.
const VAPID_TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;

// RFC 8188's record size. Everything this file sends is one short record
// well inside it, so no payload is ever split.
const RECORD_SIZE = 4096;

// ---------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------

// The three secrets, or null if any is missing. Web push is optional in
// exactly the way the Slack webhook is: without it the app runs, the
// subscribe routes still answer, and nothing is ever sent.
function readConfig(env: Env): PushConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

// The application server key a browser needs to create a subscription with,
// or null when this deployment cannot send push at all. The client asks for
// this before it offers the player anything, so an unconfigured deployment
// shows no notification control rather than a button that cannot work.
export function pushPublicKey(env: Env): string | null {
  return readConfig(env)?.publicKey ?? null;
}

// ---------------------------------------------------------------------
// The subscription registry (D1)
// ---------------------------------------------------------------------

// Records `subscription` as `playerId`'s. A browser has one subscription
// per origin no matter who is signed in on it, so this is an upsert on the
// endpoint: signing in as someone else and opting in moves the row rather
// than leaving the previous player attached to a device they no longer use.
//
// `replaces` is the endpoint this one supersedes, which only the service
// worker's `pushsubscriptionchange` handler knows — a push service may
// retire an endpoint and hand out a new one at any time. Dropping the old
// row there keeps a dead endpoint from being tried on every future turn.
export async function saveSubscription(
  db: D1Database,
  playerId: PlayerId,
  subscription: PushSubscriptionInput,
  language: string | null,
  replaces?: string,
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO push_subscriptions
         (endpoint, player_id, p256dh, auth, language, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         player_id = excluded.player_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         language = COALESCE(excluded.language, push_subscriptions.language),
         last_seen_at = excluded.last_seen_at`,
    )
    .bind(
      subscription.endpoint,
      playerId,
      subscription.p256dh,
      subscription.auth,
      language,
      now,
      now,
    )
    .run();

  if (replaces && replaces !== subscription.endpoint) {
    await forgetSubscription(db, playerId, replaces);
  }
}

// Drops one device's subscription. Scoped to the player as well as the
// endpoint: a caller may only forget a device they are signed in on.
export async function forgetSubscription(
  db: D1Database,
  playerId: PlayerId,
  endpoint: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND player_id = ?")
    .bind(endpoint, playerId)
    .run();
}

// Every device belonging to any of `playerIds`. One query for the whole
// batch of newly-waiting players, since that is how `nudgeHook` asks.
export async function subscriptionsFor(
  db: D1Database,
  playerIds: PlayerId[],
): Promise<StoredSubscription[]> {
  if (playerIds.length === 0) return [];
  const { results } = await db
    .prepare(
      `SELECT endpoint, player_id, p256dh, auth, language
       FROM push_subscriptions
       WHERE player_id IN (${playerIds.map(() => "?").join(", ")})`,
    )
    .bind(...playerIds)
    .all<{
      endpoint: string;
      player_id: string;
      p256dh: string;
      auth: string;
      language: string | null;
    }>();
  return results.map((row) => ({
    endpoint: row.endpoint,
    playerId: row.player_id,
    p256dh: row.p256dh,
    auth: row.auth,
    language: row.language,
  }));
}

// Forgets an endpoint the push service has told us is gone (404/410), from
// whichever player holds it. Unlike `forgetSubscription` this is not a
// player's own decision, so it is not scoped to one.
async function forgetDeadEndpoint(db: D1Database, endpoint: string): Promise<void> {
  await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(endpoint).run();
}

// ---------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------

// The only strings in the app that are not in web/locales/: a notification
// is rendered by the operating system, from a payload this Worker composed,
// so it can never go through i18next. The device says which language it
// wants when it subscribes.
//
// Exported for worker/push.test.ts, which fails when a language exists in
// web/locales/ and not here — the one thing that keeps adding a language
// from silently leaving its speakers with English notifications.
export const COPY: Record<string, { title: string; body: string }> = {
  en: {
    title: "Your turn in {{game}}",
    body: "Match {{code}} is waiting on you.",
  },
  it: {
    title: "Tocca a te in {{game}}",
    body: "La partita {{code}} aspetta la tua mossa.",
  },
};

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
}

// The notification one player gets about one match. `language` is whatever
// that device stored; anything the app does not speak falls back to English,
// the same way i18next does on the client.
export function composeNudge(
  language: string | null,
  match: { matchId: string; gameId: string },
): PushMessage {
  const lang = language && language in COPY ? language : "en";
  const values = { game: gameName(match.gameId, lang), code: match.matchId };
  return {
    title: fill(COPY[lang].title, values),
    body: fill(COPY[lang].body, values),
    // A path, not `PUBLIC_BASE_URL`: the service worker resolves it against
    // its own origin, so a deployment whose base URL is wrong cannot send a
    // player to somebody else's host.
    url: `/m/${match.matchId}`,
    // Both the push service (as the Topic header) and the operating system
    // (as the notification tag) collapse on this, so a second nudge about a
    // match replaces the first rather than stacking on it.
    tag: `m-${match.matchId}`,
  };
}

// ---------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const utf8 = (value: string) => new TextEncoder().encode(value);

// ---------------------------------------------------------------------
// VAPID (RFC 8292)
// ---------------------------------------------------------------------

// Web Crypto cannot import a raw P-256 private scalar, and a VAPID key pair
// is stored as exactly that: 32 raw bytes of `d`, base64url. The public key
// supplies the `x`/`y` the JWK also needs — it is the uncompressed point
// `0x04 || x || y` every subscription was created against.
async function importSigningKey(config: PushConfig): Promise<CryptoKey> {
  const publicKey = decodeBase64Url(config.publicKey);
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    throw new Error("VAPID_PUBLIC_KEY is not an uncompressed P-256 point");
  }
  const privateKey = decodeBase64Url(config.privateKey);
  if (privateKey.length !== 32) {
    throw new Error("VAPID_PRIVATE_KEY is not a 32-byte P-256 scalar");
  }
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: encodeBase64Url(publicKey.subarray(1, 33)),
      y: encodeBase64Url(publicKey.subarray(33, 65)),
      d: encodeBase64Url(privateKey),
      ext: false,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

// The `Authorization: vapid t=<jwt>, k=<key>` header for one endpoint. The
// JWT's audience is the push service's origin and nothing more of the URL —
// the endpoint's path is the subscription itself, and is a secret.
export async function vapidAuthorization(
  config: PushConfig,
  endpoint: string,
  now = Date.now(),
): Promise<string> {
  const key = await importSigningKey(config);
  const header = encodeBase64Url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = encodeBase64Url(
    utf8(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + VAPID_TOKEN_LIFETIME_SECONDS,
        sub: config.subject,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  // ECDSA signatures come out of Web Crypto as raw `r || s`, which is the
  // form JWS wants — no DER unwrapping needed.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    utf8(signingInput),
  );
  const token = `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`;
  return `vapid t=${token}, k=${encodeBase64Url(decodeBase64Url(config.publicKey))}`;
}

// ---------------------------------------------------------------------
// Payload encryption (RFC 8291, `aes128gcm` from RFC 8188)
// ---------------------------------------------------------------------

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

// One `aes128gcm` body: a 21-byte-plus-key header (salt, record size, and
// this message's ephemeral public key) followed by a single encrypted
// record. RFC 8291 §3.4.
export async function encryptPayload(
  subscription: PushSubscriptionInput,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const browserKey = decodeBase64Url(subscription.p256dh);
  const authSecret = decodeBase64Url(subscription.auth);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // A key pair of its own per message: it is what makes two notifications to
  // the same device share no key material. The cast is workerd's generated
  // types being conservative — `generateKey` is typed as returning either a
  // key or a pair, and an asymmetric algorithm always returns the pair.
  const ephemeral = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const ephemeralPublic = new Uint8Array(
    (await crypto.subtle.exportKey("raw", ephemeral.publicKey)) as ArrayBuffer,
  );

  const browserPublic = await crypto.subtle.importKey(
    "raw",
    browserKey as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  // The peer key's parameter is `public`, in workerd as in every other Web
  // Crypto. It is only spelled `$public` in the generated types, which escape
  // it because `public` is a TypeScript keyword — passing that name through
  // would leave the runtime without a peer key at all.
  const ecdh = { name: "ECDH", public: browserPublic } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, ephemeral.privateKey, 256));

  // RFC 8291 §3.3: the auth secret salts the first extraction, and the two
  // public keys are bound into its info so a shared secret cannot be
  // replayed against a different pair of keys.
  const ikm = await hkdf(
    shared,
    authSecret,
    concat(utf8("WebPush: info\0"), browserKey, ephemeralPublic),
    32,
  );
  const contentKey = await hkdf(ikm, salt, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(ikm, salt, utf8("Content-Encoding: nonce\0"), 12);

  // 0x02 is RFC 8188's delimiter for the last record; this is always the
  // only one.
  const record = concat(plaintext, new Uint8Array([0x02]));
  if (record.length + 16 > RECORD_SIZE) {
    throw new Error("push payload does not fit in one record");
  }
  const aesKey = await crypto.subtle.importKey(
    "raw",
    contentKey as BufferSource,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      aesKey,
      record as BufferSource,
    ),
  );

  const header = new Uint8Array(21 + ephemeralPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = ephemeralPublic.length;
  header.set(ephemeralPublic, 21);
  return concat(header, ciphertext);
}

// ---------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------

// Delivers one message to one device. Never throws: the three outcomes are
// the return value, and "gone" is the one that means the caller should
// forget this subscription — the browser was uninstalled, cleared, or
// revoked permission, and no later message will ever reach it.
export async function sendPush(
  config: PushConfig,
  subscription: PushSubscriptionInput,
  message: PushMessage,
): Promise<PushDelivery> {
  try {
    const body = await encryptPayload(subscription, utf8(JSON.stringify(message)));
    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthorization(config, subscription.endpoint),
        "Content-Encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        TTL: String(TTL_SECONDS),
        Topic: message.tag,
        Urgency: "normal",
      },
      body: body as BodyInit,
      // A hung push service must not hold the calling Durable Object alive
      // through ctx.waitUntil().
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404 || response.status === 410) return "gone";
    if (!response.ok) {
      console.error("push send rejected", { status: response.status });
      return "failed";
    }
    return "sent";
  } catch (err) {
    console.error("push send failed", err);
    return "failed";
  }
}

// Nudges every device belonging to `playerIds`, each in its own language,
// and forgets the ones their push service says are gone. Never throws, and
// no-ops without a word when VAPID is not configured — local dev and any
// contributor without the secrets must still be able to play.
export async function sendPushNudges(
  env: Env,
  match: { matchId: string; gameId: string; playerIds: PlayerId[] },
): Promise<void> {
  const config = readConfig(env);
  if (!config || match.playerIds.length === 0) return;

  let subscriptions: StoredSubscription[];
  try {
    subscriptions = await subscriptionsFor(env.DB, match.playerIds);
  } catch (err) {
    console.error("push subscription lookup failed", err);
    return;
  }

  // One message per device, not per player: the same player's phone and
  // laptop both get told, and each in the language it asked for.
  const deliveries = await Promise.all(
    subscriptions.map(async (subscription) => ({
      endpoint: subscription.endpoint,
      outcome: await sendPush(config, subscription, composeNudge(subscription.language, match)),
    })),
  );

  for (const { endpoint, outcome } of deliveries) {
    if (outcome !== "gone") continue;
    try {
      await forgetDeadEndpoint(env.DB, endpoint);
    } catch (err) {
      console.error("forgetting a dead push subscription failed", err);
    }
  }
}
