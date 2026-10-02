import type { Page } from "@playwright/test";

import { createMatch, expect, test } from "./fixtures";
import type { Player } from "./fixtures";

// A public lobby is listed on the hub, under Public lobbies in the Matches section, so anyone can
// join it without being sent the code. The e2e database outlives a run and is shared by parallel
// workers, so the list can hold other specs' lobbies too: a row is always picked out by its host's
// unique nickname.

// Waits for the hub to have loaded, since the list is left out altogether while it has nothing in
// it, and a check that a lobby is not listed must not pass just because nothing has loaded yet.
async function openMatches(page: Page): Promise<void> {
  await page.goto("/matches");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

function publicCardHostedBy(page: Page, host: Player) {
  return page
    .getByRole("region", { name: /^Public lobbies/ })
    .getByRole("link")
    .filter({ hasText: host.nickname });
}

// The switch's label names the current setting, so it reads "Private match" while off.
function publicSwitch(page: Page) {
  return page.getByRole("switch", { name: /^(Public|Private) match$/ });
}

// The switch's own input is visually hidden, under its thumb, so it is pressed the way a player
// presses it: by its label. The other setting's label is kept in the DOM, hidden, to hold the
// switch's width, so only the visible one is clicked.
async function pressPublicSwitch(page: Page): Promise<void> {
  await page
    .getByText(/^(Public|Private) match$/)
    .filter({ visible: true })
    .click();
}

// The lobby's switch moves as soon as it is pressed, before the server has the change, so a spec
// that goes on to look from another player's side waits for the server to confirm it first.
async function flipVisibility(host: Player): Promise<void> {
  await Promise.all([
    host.page.waitForResponse((res) => res.url().endsWith("/visibility") && res.ok()),
    pressPublicSwitch(host.page),
  ]);
}

test("a match started as public is listed on the hub, and anyone can join it from there", async ({
  newPlayer,
}) => {
  const [alice, bob] = await Promise.all([newPlayer("Alice"), newPlayer("Bob")]);

  await alice.page.goto("/play");
  await expect(publicSwitch(alice.page)).not.toBeChecked();
  await expect(publicSwitch(alice.page)).toHaveAccessibleName("Private match");
  await pressPublicSwitch(alice.page);
  await expect(publicSwitch(alice.page)).toBeChecked();
  await expect(publicSwitch(alice.page)).toHaveAccessibleName("Public match");
  await alice.page.getByRole("button", { name: "What private and public mean" }).hover();
  await expect(alice.page.getByRole("tooltip")).toContainText(
    "Listed under Public lobbies on everyone's hub",
  );

  await alice.page.getByRole("button", { name: "Start a new Tic-tac-toe match" }).click();
  await expect(alice.page).toHaveURL(/\/m\/[A-Z2-9]{6}$/);
  const code = new URL(alice.page.url()).pathname.slice("/m/".length);
  await expect(publicSwitch(alice.page)).toBeChecked();
  await expect(alice.live).toBeVisible();

  await openMatches(bob.page);
  const card = publicCardHostedBy(bob.page, alice);
  await expect(card).toContainText("Tic-tac-toe");
  await expect(card).toContainText("Join");
  await card.click();

  // Bob took the last seat, so the match started for both of them.
  await expect(bob.page).toHaveURL(`/m/${code}`);
  await expect(bob.yourTurn.or(bob.waitingOn(alice))).toBeVisible();
  await expect(alice.yourTurn.or(alice.waitingOn(bob))).toBeVisible();
});

test("a match is private unless the host makes it public, and can go back", async ({
  newPlayer,
}) => {
  const [alice, bob] = await Promise.all([newPlayer("Alice"), newPlayer("Bob")]);
  const code = await createMatch(alice, "tictactoe");
  await alice.page.goto(`/m/${code}`);
  await expect(alice.live).toBeVisible();
  await expect(publicSwitch(alice.page)).not.toBeChecked();

  await openMatches(bob.page);
  await expect(publicCardHostedBy(bob.page, alice)).toHaveCount(0);

  await flipVisibility(alice);
  await openMatches(bob.page);
  await expect(publicCardHostedBy(bob.page, alice)).toBeVisible();

  await flipVisibility(alice);
  await expect(publicSwitch(alice.page)).not.toBeChecked();
  await openMatches(bob.page);
  await expect(publicCardHostedBy(bob.page, alice)).toHaveCount(0);
});

test("a public lobby leaves the list once its last seat starts it", async ({ newPlayer }) => {
  const [alice, bob, carol] = await Promise.all(
    ["Alice", "Bob", "Carol"].map((name) => newPlayer(name)),
  );
  const res = await alice.context.request.post("/api/matches", {
    data: { gameId: "tictactoe", visibility: "public" },
  });
  await expect(res).toBeOK();

  await openMatches(bob.page);
  await publicCardHostedBy(bob.page, alice).click();
  await expect(bob.yourTurn.or(bob.waitingOn(alice))).toBeVisible();

  await openMatches(carol.page);
  await expect(publicCardHostedBy(carol.page, alice)).toHaveCount(0);
});
