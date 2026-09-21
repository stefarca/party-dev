import { decodeBase64Url } from "../shared/base64url";
import type { PushSubscriptionPayload } from "../shared/protocol";
import { getPushKey, subscribePush, unsubscribePush } from "./api";
import { navigate } from "./router";

// Turning "nudge me when it is my turn" on and off for this browser.
//
// A push subscription belongs to one browser, not to an account: opting in
// on a phone says nothing about a laptop, and signing in as someone else on
// the same browser hands that same subscription to them (the server upserts
// on the endpoint, so the rows never disagree about who a device belongs
// to).
//
// Three things all have to be true before a player is offered anything, and
// each of them is false somewhere real:
//
//   - the browser speaks push at all (Safari only does in an installed app),
//   - a service worker is actually registered — no dev server registers one,
//     so this is false throughout `npm run dev` and the Playwright suite,
//   - the deployment has VAPID keys, which are optional like the Slack
//     webhook.
//
// Any of them missing is `"unavailable"`, and the control renders nothing.

export type PushState = "unavailable" | "denied" | "off" | "on";

// How long to wait for a service worker to reach "activated". Long enough to
// cover the first load after an install, where the worker registers a moment
// after this runs, and short enough that a dev server's answer (there will
// never be one) does not hold the header's control in limbo.
const REGISTRATION_TIMEOUT_MS = 3000;

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// The active service worker registration, or null where there is none.
// `navigator.serviceWorker.ready` is the only way to be sure a worker has
// finished activating, but it never settles at all when nothing is ever
// registered — which is every dev server — so it is raced against a timeout
// rather than awaited.
function activeRegistration(): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), REGISTRATION_TIMEOUT_MS)),
  ]);
}

// The language this device was last registered under, for as long as the page
// lives. It is what keeps turning notifications on from writing the same
// subscription twice in a row — `enablePush` has already registered it in the
// current language by the time the language effect gets its turn.
let registeredLanguage: string | null = null;

// The deployment's application server key, fetched once per page load. It
// cannot change under a loaded page — a new one only arrives with a new
// build, and a build only reaches a player through the update prompt.
let keyRequest: Promise<string | null> | null = null;
function serverKey(): Promise<string | null> {
  keyRequest ??= getPushKey().catch(() => null);
  return keyRequest;
}

// Whether `subscription` was created against `key`. A subscription is bound
// to the application server key it was made with, and a push service refuses
// any message signed with a different one — so after a key rotation the only
// way forward is to drop it and subscribe again.
function usesKey(subscription: PushSubscription, key: string): boolean {
  const applied = subscription.options.applicationServerKey;
  if (!applied) return false;
  const a = new Uint8Array(applied);
  const b = decodeBase64Url(key);
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

// The subscription in the shape the API takes, or null for one the browser
// gave us without keys (which cannot be encrypted to, and so is no use).
function toPayload(subscription: PushSubscription): PushSubscriptionPayload | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}

// What the control should show, without asking the player for anything.
export async function readPushState(): Promise<PushState> {
  if (!supported()) return "unavailable";
  const [registration, key] = await Promise.all([activeRegistration(), serverKey()]);
  if (!registration || !key) return "unavailable";
  if (Notification.permission === "denied") return "denied";
  const subscription = await registration.pushManager.getSubscription();
  return subscription && usesKey(subscription, key) ? "on" : "off";
}

// Asks for permission if it has not been given, subscribes, and registers
// the subscription against the signed-in player. Must be called from a click:
// browsers only open the permission prompt in response to a gesture.
export async function enablePush(language: string): Promise<PushState> {
  if (!supported()) return "unavailable";

  // Before anything is awaited: a browser only opens the prompt while the
  // click that led here still counts as a gesture, and that window is short.
  // Nothing is lost by asking first — the control is only ever rendered
  // once `readPushState` has found both a worker and a key.
  const permission = await Notification.requestPermission();
  // "default" is a prompt the player dismissed without answering: nothing to
  // report, and asking again later is allowed.
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";

  const [registration, key] = await Promise.all([activeRegistration(), serverKey()]);
  if (!registration || !key) return "unavailable";

  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !usesKey(subscription, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeBase64Url(key) as BufferSource,
  });

  const payload = toPayload(subscription);
  if (!payload) return "off";

  // If the server will not take the device, this browser must not go on
  // holding a subscription that says it did: `readPushState` reads the
  // browser's subscription, not the server's row, so leaving it in place
  // would show a player notifications are on while nothing could ever
  // arrive. Dropping it means the next attempt starts clean, and the
  // failure reaches the caller rather than being swallowed here.
  try {
    await subscribePush(payload, language);
  } catch (err) {
    await subscription.unsubscribe().catch(() => {});
    throw err;
  }
  registeredLanguage = language;
  return "on";
}

// Stops the nudges for this browser. The server is told first: a browser
// that dropped its subscription while the row survived would leave the
// server encrypting notifications to an endpoint nobody will ever read.
export async function disablePush(): Promise<PushState> {
  if (!supported()) return "unavailable";
  const registration = await activeRegistration();
  if (!registration) return "unavailable";

  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    await unsubscribePush(subscription.endpoint);
    await subscription.unsubscribe();
  }
  registeredLanguage = null;
  return Notification.permission === "denied" ? "denied" : "off";
}

// Re-registers the current subscription so the server composes this device's
// notifications in `language`. Best-effort: a failure costs a player one
// notification in their previous language, never the language switch itself.
//
// Called once per load as well as on every switch, so it doubles as a repair:
// a subscription the server has lost comes back without the player doing
// anything. A repeat of what this page has already sent is skipped.
export async function syncPushLanguage(language: string): Promise<void> {
  if (!supported() || registeredLanguage === language) return;
  const registration = await activeRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  const payload = subscription ? toPayload(subscription) : null;
  if (!payload) return;
  await subscribePush(payload, language);
  registeredLanguage = language;
}

// Takes a notification click to its match when this page is already open.
// The service worker asks the page to route there itself rather than
// navigating the window from outside, which some browsers cannot do and
// others refuse for a window the worker does not control (see `askToOpen` in
// public/push-sw.js). Replying is how the worker knows it need not try
// anything else; a path that is not this origin's is ignored, unanswered.
export function followNotificationClicks(): void {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    const data: unknown = event.data;
    if (typeof data !== "object" || data === null) return;
    const { type, path } = data as { type?: unknown; path?: unknown };
    if (type !== "open" || typeof path !== "string") return;
    const target = new URL(path, window.location.origin);
    if (target.origin !== window.location.origin) return;
    const next = target.pathname + target.search + target.hash;
    if (next !== window.location.pathname + window.location.search + window.location.hash) {
      navigate(next);
    }
    event.ports[0]?.postMessage("opened");
  });
  // Messages from the worker wait in a queue until the page says it is
  // listening, and a page woken by the click is listening from here on.
  navigator.serviceWorker.startMessages();
}
