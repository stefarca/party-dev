import { devices } from "@playwright/test";
import type { Page } from "@playwright/test";

import { createMatch, expect, test } from "./fixtures";
import type { Player } from "./fixtures";

// The hub's offer to install the app. It only exists where installing does, so each case has to
// stand in for a browser: an iPhone by its user agent, and Chromium by `beforeinstallprompt`,
// which the test browser never sends on its own. The event here is the one Chromium would send,
// with its dialog answered in advance.

const IPHONE = devices["iPhone 15"];

function installCard(page: Page) {
  return page.getByRole("region", { name: "Install Pimpom" });
}

async function openHub(player: Player): Promise<void> {
  await player.page.goto("/");
  await expect(
    player.page.getByRole("heading", { name: `Hey ${player.nickname} 👋` }),
  ).toBeVisible();
}

// What Chromium does for an installable page, with the player's answer to its install dialog
// fixed up front. `window.installPrompted` is how the spec sees that the dialog was asked for.
async function announceInstallable(page: Page, outcome: "accepted" | "dismissed"): Promise<void> {
  await page.evaluate((outcome) => {
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: () => {
        (window as unknown as { installPrompted: boolean }).installPrompted = true;
        return Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome, platform: "web" }),
    });
    window.dispatchEvent(event);
  }, outcome);
}

test("an iPhone player is shown how to add the app to the Home Screen", async ({ newPlayer }) => {
  const player = await newPlayer("Alice", IPHONE);
  await createMatch(player, "connect4");
  await openHub(player);

  const card = installCard(player.page);
  await expect(card).toContainText("Tap Share, then Add to Home Screen.");
  // Safari has no install dialog to open, so there is nothing for such a button to do.
  await expect(card.getByRole("button", { name: "Install" })).toHaveCount(0);

  await card.getByRole("button", { name: "Not now" }).click();
  await expect(card).toHaveCount(0);

  await openHub(player);
  await expect(installCard(player.page)).toHaveCount(0);
});

test("a player with no matches yet is not asked to install", async ({ newPlayer }) => {
  const player = await newPlayer("Alice", IPHONE);
  await openHub(player);
  await expect(installCard(player.page)).toHaveCount(0);
});

test("the installed app does not offer itself", async ({ newPlayer }) => {
  const player = await newPlayer("Alice", IPHONE);
  // What iOS sets on a page opened from its Home Screen icon.
  await player.page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true });
  });
  await createMatch(player, "connect4");
  await openHub(player);
  await expect(installCard(player.page)).toHaveCount(0);
});

test("the card opens the browser's own install dialog", async ({ newPlayer }) => {
  const player = await newPlayer("Alice");
  await createMatch(player, "connect4");
  await openHub(player);
  await expect(installCard(player.page)).toHaveCount(0);

  await announceInstallable(player.page, "accepted");
  const card = installCard(player.page);
  await card.getByRole("button", { name: "Install" }).click();

  await expect
    .poll(() =>
      player.page.evaluate(
        () => (window as unknown as { installPrompted?: boolean }).installPrompted,
      ),
    )
    .toBe(true);
  await expect(card).toHaveCount(0);
});

// Turning the browser's dialog down is the same answer as "Not now", and the next page load's
// event does not bring the card back.
test("declining the install dialog puts the offer away", async ({ newPlayer }) => {
  const player = await newPlayer("Alice");
  await createMatch(player, "connect4");
  await openHub(player);

  await announceInstallable(player.page, "dismissed");
  await installCard(player.page).getByRole("button", { name: "Install" }).click();
  await expect(installCard(player.page)).toHaveCount(0);

  await openHub(player);
  await announceInstallable(player.page, "dismissed");
  await expect(installCard(player.page)).toHaveCount(0);
});
