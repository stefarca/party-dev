import type { Page } from "@playwright/test";

import { createMatch, expect, test } from "./fixtures";
import type { Player } from "./fixtures";

// A public lobby is listed under the hub's Public tab, so anyone can join it without being sent
// the code. The e2e database outlives a run and is shared by parallel workers, so the tab can hold
// other specs' lobbies too: a card is always picked out by its host's unique nickname.

async function openPublicTab(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("tab", { name: /^Public/ }).click();
}

function publicCardHostedBy(page: Page, host: Player) {
  return page.getByRole("tabpanel").getByRole("link").filter({ hasText: host.nickname });
}

function publicSwitch(page: Page) {
  return page.getByRole("switch", { name: "Public match" });
}

// The switch's own input is visually hidden, under its thumb, so it is pressed the way a player
// presses it: by its label.
async function pressPublicSwitch(page: Page): Promise<void> {
  await page.getByText("Public match", { exact: true }).click();
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

  await alice.page.goto("/");
  await expect(publicSwitch(alice.page)).not.toBeChecked();
  await pressPublicSwitch(alice.page);
  await expect(publicSwitch(alice.page)).toBeChecked();
  await expect(alice.page.getByText("Listed under Public on everyone's hub")).toBeVisible();

  await alice.page.getByRole("button", { name: "Start a new Tic-tac-toe match" }).click();
  await expect(alice.page).toHaveURL(/\/m\/[A-Z2-9]{6}$/);
  const code = new URL(alice.page.url()).pathname.slice("/m/".length);
  await expect(publicSwitch(alice.page)).toBeChecked();
  await expect(alice.live).toBeVisible();

  await openPublicTab(bob.page);
  const card = publicCardHostedBy(bob.page, alice);
  await expect(card).toContainText("Tic-tac-toe");
  await expect(card).toContainText("Join");
  await card.click();

  await expect(bob.page).toHaveURL(`/m/${code}`);
  await expect(bob.page.getByText("Waiting for the host to start.")).toBeVisible();
  // Who can join is the host's call alone.
  await expect(publicSwitch(bob.page)).toHaveCount(0);
  await expect(alice.page.getByRole("listitem").filter({ hasText: bob.nickname })).toBeVisible();
  await expect(alice.page.getByRole("button", { name: /^Start match/ })).toBeEnabled();
});

test("a match is private unless the host makes it public, and can go back", async ({
  newPlayer,
}) => {
  const [alice, bob] = await Promise.all([newPlayer("Alice"), newPlayer("Bob")]);
  const code = await createMatch(alice, "tictactoe");
  await alice.page.goto(`/m/${code}`);
  await expect(alice.live).toBeVisible();
  await expect(publicSwitch(alice.page)).not.toBeChecked();

  await openPublicTab(bob.page);
  await expect(publicCardHostedBy(bob.page, alice)).toHaveCount(0);

  await flipVisibility(alice);
  await openPublicTab(bob.page);
  await expect(publicCardHostedBy(bob.page, alice)).toBeVisible();

  await flipVisibility(alice);
  await expect(publicSwitch(alice.page)).not.toBeChecked();
  await openPublicTab(bob.page);
  await expect(publicCardHostedBy(bob.page, alice)).toHaveCount(0);
});

test("a public lobby leaves the list once it is full", async ({ newPlayer }) => {
  const [alice, bob, carol] = await Promise.all(
    ["Alice", "Bob", "Carol"].map((name) => newPlayer(name)),
  );
  const res = await alice.context.request.post("/api/matches", {
    data: { gameId: "tictactoe", visibility: "public" },
  });
  await expect(res).toBeOK();

  await openPublicTab(bob.page);
  await publicCardHostedBy(bob.page, alice).click();
  await expect(bob.page.getByText("Waiting for the host to start.")).toBeVisible();

  await openPublicTab(carol.page);
  await expect(publicCardHostedBy(carol.page, alice)).toHaveCount(0);
});
