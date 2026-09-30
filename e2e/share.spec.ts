import type { APIRequestContext } from "@playwright/test";

import { createMatch, expect, test } from "./fixtures";
import type { Player } from "./fixtures";

// Shared links: the preview a chat app draws under a match link or a daily
// challenge, which comes from the page's Open Graph tags as the server sent
// them (a crawler never runs the app), and what a challenge link shows the
// friend who opens it.

// The page at `path` as a link-preview crawler reads it: no cookie, no
// JavaScript, just the HTML.
async function previewOf(request: APIRequestContext, path: string) {
  const res = await request.get(path, { headers: { "Accept-Language": "en" } });
  await expect(res).toBeOK();
  const html = await res.text();
  const meta = (property: string) =>
    html.match(new RegExp(`<meta property="${property}" content="([^"]*)"`))?.[1];
  return {
    title: meta("og:title"),
    description: meta("og:description"),
    image: meta("og:image"),
    pageTitle: html.match(/<title>([^<]*)<\/title>/)?.[1],
  };
}

// Records what the page hands the share sheet, instead of opening one.
async function captureShares(player: Player) {
  await player.context.addInitScript(() => {
    const shared: ShareData[] = [];
    (window as unknown as { shared: ShareData[] }).shared = shared;
    navigator.share = async (data?: ShareData) => {
      if (data) shared.push(data);
    };
  });
}

async function lastShare(player: Player): Promise<ShareData> {
  const shares = await player.page.evaluate(
    () => (window as unknown as { shared: ShareData[] }).shared,
  );
  expect(shares.length).toBeGreaterThan(0);
  return shares[shares.length - 1];
}

async function playAndEnd(player: Player, path: string) {
  await player.page.goto(path);
  await player.page.getByRole("button", { name: "Start today's run" }).click();
  await expect(player.page.getByRole("group", { name: "Slide the tiles" })).toBeVisible();
  await player.page.getByRole("button", { name: "End run" }).click();
  await player.page.getByRole("alertdialog").getByRole("button", { name: "End run" }).click();
  await expect(player.page.getByRole("heading", { name: "Today's run is over" })).toBeVisible();
}

test("a match link's preview names the host, the game and the seats left", async ({
  newPlayer,
  request,
}) => {
  const ada = await newPlayer("Ada");
  const code = await createMatch(ada, "connect4");

  const preview = await previewOf(request, `/m/${code}`);
  expect(preview.title).toBe(`${ada.nickname} invited you to play Connect 4`);
  expect(preview.pageTitle).toBe(preview.title);
  expect(preview.description).toBe("1 seat left. Tap to join before it fills up.");
  // A crawler needs the image's full address.
  expect(preview.image).toMatch(/^https?:\/\/[^/]+\/og-image\.png$/);
  const image = await request.get(preview.image!);
  await expect(image).toBeOK();
  expect(image.headers()["content-type"]).toBe("image/png");

  // A link shared from the app in Italian previews in Italian.
  expect((await previewOf(request, `/m/${code}?lang=it`)).title).toBe(
    `${ada.nickname} ti invita a giocare a Forza 4`,
  );

  // And the page behind the preview is still the app.
  await ada.page.goto(`/m/${code}`);
  await expect(ada.page.getByRole("heading", { name: "Invite your crew" })).toBeVisible();
});

test("the invite panel hands the match link to the share sheet", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await captureShares(ada);
  const code = await createMatch(ada, "connect4");

  await ada.page.goto(`/m/${code}`);
  await ada.page.getByRole("button", { name: "Share", exact: true }).click();
  await expect
    .poll(async () => (await lastShare(ada)).text)
    .toBe("Come play Connect 4 with me on Pimpom!");
  expect((await lastShare(ada)).url).toMatch(new RegExp(`/m/${code}$`));
});

test("a finished daily run challenges friends through a link that says what to beat", async ({
  newPlayer,
  request,
}) => {
  const ada = await newPlayer("Ada");
  await captureShares(ada);
  await playAndEnd(ada, "/daily/2048");

  await ada.page.getByRole("button", { name: "Challenge your friends" }).click();
  await expect.poll(async () => (await lastShare(ada)).url).toContain(`from=${ada.id}`);
  const share = await lastShare(ada);
  expect(share.text).toMatch(/^I scored 0 at today's 2048 on Pimpom.* Can you beat me\?$/);
  const url = new URL(share.url!);

  // The friend's chat shows whose score it is before they open anything.
  const preview = await previewOf(request, url.pathname + url.search);
  expect(preview.title).toBe(`${ada.nickname} scored 0 at 2048. Can you beat it?`);
  expect(preview.description).toMatch(/^#\d+ of \d+ on the chart for /);

  // Opening it shows the challenge above today's board.
  const bea = await newPlayer("Bea");
  await bea.page.goto(url.pathname + url.search);
  const challenge = bea.page.getByRole("region", { name: "Challenge" });
  await expect(
    challenge.getByRole("heading", { name: `${ada.nickname} challenges you` }),
  ).toBeVisible();
  await expect(challenge.getByText("Beat 0 to win.")).toBeVisible();

  // Both untouched runs score the same, on the same board.
  await playAndEnd(bea, url.pathname + url.search);
  await expect(challenge.getByText(`Dead heat with ${ada.nickname}!`)).toBeVisible();
});

test("a player's own challenge link is no challenge to them", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await playAndEnd(ada, "/daily/2048");
  const day = new Date().toISOString().slice(0, 10);
  await ada.page.goto(`/daily/2048?from=${ada.id}&day=${day}`);
  await expect(ada.page.getByRole("heading", { name: "Today's run is over" })).toBeVisible();
  await expect(ada.page.getByRole("region", { name: "Challenge" })).toHaveCount(0);
});
