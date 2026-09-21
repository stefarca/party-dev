import { expect, test } from "./fixtures";

// Turn notifications, as far as they can be driven here.
//
// The delivery half cannot: a notification needs a service worker, and no dev
// server registers one (see vite.config.ts), a real push service, and a
// browser permission Chromium will not grant headlessly. What is left — and
// what a player actually meets — is the registry the app keeps of the devices
// to notify, and what the header offers when none of that is available.
//
// `npm run e2e:serve` loads only SESSION_SECRET, so this server has no VAPID
// keys by construction: exactly the "push is not configured here" case.

// A subscription shaped exactly as a browser hands one over: an uncompressed
// P-256 point and a 16-byte secret, both base64url. The server checks those
// sizes, so a stand-in that only looked like base64 would be rejected here
// for a reason no player would ever hit.
const DEVICE = {
  endpoint: "https://push.example.test/e2e-device",
  keys: {
    p256dh:
      "BPsxf2_2orGwbs3gc6NOHRKL9aFgmxUrlQvaUM6dsnGX1pWDlLue9T_H7oljAelWBJIwpnG_Qbta5Ur564QH0D4",
    auth: "X9TbAOB0DtjLm6Z3OTgsRA",
  },
};

test("the header offers no notification control where nothing could be delivered", async ({
  newPlayer,
}) => {
  const alice = await newPlayer("Alice");
  await alice.page.goto("/");

  // The player is signed in and the header is up — the controls beside the
  // bell are there, so its absence is a decision and not a slow load.
  await expect(
    alice.page.getByRole("button", { name: `Signed in as ${alice.nickname}` }),
  ).toBeVisible();
  await expect(
    alice.page.getByRole("button", { name: "Notify me when it is my turn" }),
  ).toHaveCount(0);
  await expect(alice.page.getByRole("button", { name: "Turn off turn notifications" })).toHaveCount(
    0,
  );
});

test("the app reports that this deployment cannot send notifications", async ({ request }) => {
  const res = await request.get("/api/push/key");
  await expect(res).toBeOK();
  // Null rather than a 404: the question "can you notify me" has an answer
  // here, and it is no.
  expect(await res.json()).toEqual({ key: null });
});

test("a player registers a device, re-registers it, and drops it again", async ({ newPlayer }) => {
  const alice = await newPlayer("Alice");

  const first = await alice.context.request.post("/api/push/subscribe", {
    data: { subscription: DEVICE, language: "en" },
  });
  await expect(first, "registers this device").toBeOK();

  // A browser keeps one subscription per origin, so sending the same one
  // again is how the app refreshes it — never an error, never a second row.
  const again = await alice.context.request.post("/api/push/subscribe", {
    data: { subscription: DEVICE, language: "it" },
  });
  await expect(again, "re-registers the same device").toBeOK();

  const dropped = await alice.context.request.post("/api/push/unsubscribe", {
    data: { endpoint: DEVICE.endpoint },
  });
  await expect(dropped, "drops the device").toBeOK();

  // "Do not notify this device" holds whether or not there was anything to
  // forget, so asking twice is a success both times.
  const twice = await alice.context.request.post("/api/push/unsubscribe", {
    data: { endpoint: DEVICE.endpoint },
  });
  await expect(twice, "drops it again").toBeOK();
});

test("an endpoint the server would POST to has to be https", async ({ newPlayer }) => {
  const alice = await newPlayer("Alice");
  for (const endpoint of ["http://push.example.test/insecure", "not-a-url", ""]) {
    const res = await alice.context.request.post("/api/push/subscribe", {
      data: { subscription: { ...DEVICE, endpoint }, language: "en" },
    });
    expect(res.status(), `rejects ${JSON.stringify(endpoint)}`).toBe(400);
  }
});

test("keys that could never be encrypted to are refused, not stored", async ({ newPlayer }) => {
  const alice = await newPlayer("Alice");
  for (const [label, keys] of [
    ["a public key of the wrong size", { ...DEVICE.keys, p256dh: "c2hvcnQ" }],
    ["an auth secret of the wrong size", { ...DEVICE.keys, auth: "c2hvcnQ" }],
    [
      "a public key that is not a point",
      { ...DEVICE.keys, p256dh: "A" + DEVICE.keys.p256dh.slice(1) },
    ],
  ] as const) {
    const res = await alice.context.request.post("/api/push/subscribe", {
      data: { subscription: { ...DEVICE, keys }, language: "en" },
    });
    expect(res.status(), `rejects ${label}`).toBe(400);
  }
});

test("a device belongs to a player, so registering one needs a session", async ({ request }) => {
  const res = await request.post("/api/push/subscribe", {
    data: { subscription: DEVICE, language: "en" },
  });
  expect(res.status()).toBe(401);
});
