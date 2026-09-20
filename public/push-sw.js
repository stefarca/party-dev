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
  title: "party",
  body: "A match is waiting on you.",
  url: "/",
  tag: "party",
};

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

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = sameOriginUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Already looking at that match: just bring it forward. Opening a
      // second tab on the same match would leave two live sockets.
      for (const client of windows) {
        if (new URL(client.url).pathname === url.pathname) {
          await client.focus();
          return;
        }
      }
      // Otherwise steer a window that is already open, rather than piling up
      // one tab per notification.
      const open = windows[0];
      if (open && "navigate" in open) {
        await open.focus();
        await open.navigate(url.href);
        return;
      }
      await self.clients.openWindow(url.href);
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
