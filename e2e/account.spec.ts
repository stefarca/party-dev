import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

// Keeping a nickname to its owner without asking anyone to register: a device typing a nickname
// somebody holds waits on the owner's approval, or takes their PIN or passkey once they lock it.
// Every player here was just signed in over the API, so the server counts them as having a
// device that could answer.

async function typeNickname(page: Page, nickname: string) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Pick a nickname" }).fill(nickname);
  await page.getByRole("button", { name: "Let's play" }).click();
}

async function openProfile(page: Page, nickname: string) {
  await page
    .getByRole("button", { name: `Signed in as ${nickname}. Profile and settings` })
    .click();
  return page.getByRole("dialog", { name: "Profile and settings" });
}

test("the owner can turn a sign-in down", async ({ newPlayer, browser }) => {
  const alice = await newPlayer("Alice");
  const stranger = await browser.newContext();
  try {
    const page = await stranger.newPage();
    await typeNickname(page, alice.nickname);
    await expect(page.getByRole("heading", { name: `${alice.nickname} is taken` })).toBeVisible();
    await expect(page.getByText(/If nobody answers, you're let in in \d:\d\d/)).toBeVisible();

    await alice.page.goto("/");
    await alice.page
      .getByRole("region", { name: "Sign-in request" })
      .getByRole("button", { name: "Deny" })
      .click();

    await expect(page.getByText("The sign-in was turned down.")).toBeVisible();
    await page.getByRole("button", { name: "Use another nickname" }).click();
    await expect(page.getByRole("textbox", { name: "Pick a nickname" })).toBeVisible();
  } finally {
    await stranger.close();
  }
});

test("a PIN locks the nickname, earns an achievement, and signs a new device in", async ({
  newPlayer,
  browser,
}) => {
  const alice = await newPlayer("Alice");
  await alice.page.goto("/");

  const profile = await openProfile(alice.page, alice.nickname);
  await profile.getByRole("button", { name: "Set a PIN" }).click();
  await profile.getByRole("textbox", { name: "New PIN (4 to 8 digits)" }).fill("2468");
  await profile.getByRole("button", { name: "Save PIN" }).click();
  await expect(profile.getByText("PIN saved.")).toBeVisible();
  await expect(profile.getByRole("button", { name: "Change PIN" })).toBeVisible();
  await alice.page.keyboard.press("Escape");

  const toast = alice.page.getByRole("status").filter({ hasText: "Achievement unlocked!" });
  await expect(toast.getByText("Locked in", { exact: true })).toBeVisible();

  const laptop = await browser.newContext();
  try {
    const page = await laptop.newPage();
    await typeNickname(page, alice.nickname);
    await expect(page.getByText("This nickname is locked.")).toBeVisible();
    // A locked name never lets anyone in on the clock.
    await expect(page.getByText(/If nobody answers/)).toHaveCount(0);

    const pin = page.getByRole("textbox", { name: "PIN" });
    await pin.fill("1111");
    await page.getByRole("button", { name: "Sign in with PIN" }).click();
    await expect(page.getByText("Wrong PIN.")).toBeVisible();

    await pin.fill("2468");
    await page.getByRole("button", { name: "Sign in with PIN" }).click();
    await expect(page.getByRole("heading", { name: `Hey ${alice.nickname} 👋` })).toBeVisible();

    // The first device hears about it, and can throw the new one out.
    await alice.page.reload();
    const recent = alice.page.getByRole("region", { name: "New sign-ins" });
    // Named by browser and system, from the new device's User-Agent.
    await expect(recent).toContainText(/Chrome on \w+/);
    await recent.getByRole("button", { name: "Sign out everywhere" }).click();
    await expect(alice.page.getByText("Every other device is signed out.")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("textbox", { name: "Pick a nickname" })).toBeVisible();
    await alice.page.reload();
    await expect(
      alice.page.getByRole("heading", { name: `Hey ${alice.nickname} 👋` }),
    ).toBeVisible();
  } finally {
    await laptop.close();
  }
});

test("a passkey signs the player back in", async ({ newPlayer }) => {
  const alice = await newPlayer("Alice");
  const page = alice.page;
  // A software authenticator in place of the device's own, which keeps its passkeys for as long
  // as the page lives.
  const cdp = await alice.context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });

  await page.goto("/");
  const profile = await openProfile(page, alice.nickname);
  await profile.getByRole("button", { name: "Add a passkey" }).click();
  await expect(profile.getByText("Passkey added.")).toBeVisible();
  await expect(profile.getByRole("button", { name: "Remove passkey" })).toBeVisible();

  await profile.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Pick a nickname" })).toBeVisible();
  await typeNickname(page, alice.nickname);
  await expect(page.getByText("This nickname is locked.")).toBeVisible();
  await page.getByRole("button", { name: "Use a passkey" }).click();
  await expect(page.getByRole("heading", { name: `Hey ${alice.nickname} 👋` })).toBeVisible();
});
