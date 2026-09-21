// The push half of the service worker.
//
// Workbox generates the rest of the worker (precaching, the navigation
// fallback) and pulls this file in with `importScripts`, so it is served
// verbatim from public/ rather than bundled: no imports, no TypeScript, and
// nothing in here may assume anything about the app's JavaScript.
//
// It runs when the app is not open, which is the whole point, and that
// shapes every handler below:
//
//   - A `push` event under `userVisibleOnly` MUST end in a notification. A
//     handler that shows nothing gets the browser's own "this site was
//     updated in the background" instead, so every failure path here still
//     shows something.
//   - The payload is composed and encrypted by worker/push.ts, in the
//     language this device asked for. Nothing is translated here — there is
//     no i18next in a service worker.
//   - A push service may retire an endpoint at any time. `pushsubscriptionchange`
//     is the only warning, and it fires with no page open to react to it.

const FALLBACK = {
  title: "Pimpom",
  body: "A match is waiting on you.",
  url: "/",
  tag: "pimpom",
};

// How long a click waits for an open page to say it has gone to the match
// before steering the window some other way. A page frozen in the background
// needs a moment to wake up and answer; a page from a build that predates the
// message never will.
const OPEN_REPLY_TIMEOUT_MS = 1500;

function readMessage(data) {
  if (!data) return FALLBACK;
  try {
    const payload = data.json();
    return {
      title: typeof payload.title === "string" ? payload.title : FALLBACK.title,
      body: typeof payload.body === "string" ? payload.body : FALLBACK.body,
      url: typeof payload.url === "string" ? payload.url : FALLBACK.url,
      tag: typeof payload.tag === "string" ? payload.tag : FALLBACK.tag,
    };
  } catch {
    return FALLBACK;
  }
}

// Whatever the payload says, resolved against this origin — and replaced by
// the hub if it points anywhere else.
function sameOriginUrl(raw) {
  try {
    const target = new URL(raw, self.location.origin);
    if (target.origin === self.location.origin) return target;
  } catch {
    // Fall through to the hub.
  }
  return new URL("/", self.location.origin);
}

self.addEventListener("push", (event) => {
  const message = readMessage(event.data);
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      // Both the notification tag and the push service's Topic header are
      // the match, so a second nudge about it replaces the first instead of
      // stacking another line on someone's lock screen.
      tag: message.tag,
      icon: "/icon-192.png",
      // Android draws this tiny and monochrome in the status bar; it is the
      // same file because the app ships no separate badge asset.
      badge: "/icon-192.png",
      data: { url: sameOriginUrl(message.url).href },
    }),
  );
});

// Asks an open page to show `url` itself, through the app's own router (see
// `followNotificationClicks` in web/push.ts), and resolves to whether it said
// it did. This is the one way of moving a window that works everywhere:
// `WindowClient.navigate()` refuses any window this worker does not control
// (a page opened before it activated, or one force-reloaded past it), and not
// every browser has it at all — which is how a click used to bring the app
// forward still showing the hub.
function askToOpen(client, url) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), OPEN_REPLY_TIMEOUT_MS);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve(true);
    };
    client.postMessage({ type: "open", path: url.pathname + url.search + url.hash }, [
      channel.port2,
    ]);
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = sameOriginUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (windows.length === 0) {
        await self.clients.openWindow(url.href);
        return;
      }
      // A window already on that match if there is one, so a second tab never
      // opens a second live socket on it; otherwise the most recently focused
      // one, which is the order `matchAll` returns windows in. Steering a
      // window that is already open, rather than opening one per click, is
      // what keeps an installed app from piling up windows.
      const onMatch = windows.find((client) => new URL(client.url).pathname === url.pathname);
      const target = onMatch || windows[0];
      // Focusing spends the click's permission to raise a window, so it comes
      // first and is not retried; a browser that refuses it still gets the
      // page moved.
      await target.focus().catch(() => {});
      if (onMatch) return;
      if (await askToOpen(target, url)) return;
      try {
        await target.navigate(url.href);
      } catch {
        await self.clients.openWindow(url.href).catch(() => {});
      }
    })(),
  );
});

// The push service has replaced this browser's endpoint. Subscribe again
// with the same application server key and tell the app, naming the endpoint
// this one supersedes so the dead row goes away with it. The session cookie
// rides along on a same-origin fetch, which is what identifies the player —
// there is nobody to ask here.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const previous =
        event.oldSubscription || (await self.registration.pushManager.getSubscription());
      let fresh = event.newSubscription;
      if (!fresh) {
        const key = previous && previous.options && previous.options.applicationServerKey;
        if (!key) return;
        fresh = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
      }
      await fetch("/api/push/subscribe", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subscription: fresh.toJSON(),
          replaces: previous ? previous.endpoint : undefined,
        }),
      });
    })().catch((err) => {
      // Nothing to show a player here; the app re-subscribes on its next
      // load, when web/push.ts finds no subscription.
      console.error("pushsubscriptionchange failed", err);
    }),
  );
});
