import { expect, test } from "./fixtures";
import type { Player } from "./fixtures";

// The header's language menu. Its accessible name says which language is showing, in that
// language.
function languageMenu(player: Player) {
  return player.page.getByRole("button", { name: /^(Language|Lingua): / });
}

async function switchLanguage(player: Player, to: string) {
  await languageMenu(player).click();
  await player.page.getByRole("menuitemradio", { name: to }).click();
}

test("a player can switch to Italian, and it sticks", async ({ newPlayer }) => {
  const alice = await newPlayer("Alice");
  await alice.page.goto("/");
  await expect(alice.page.getByRole("heading", { name: "Hey Alice 👋" })).toBeVisible();

  await switchLanguage(alice, "Italiano");
  await expect(alice.page.getByRole("heading", { name: "Ciao Alice 👋" })).toBeVisible();
  await expect(languageMenu(alice)).toHaveAccessibleName("Lingua: Italiano");
  await expect(alice.page.locator("html")).toHaveAttribute("lang", "it");

  await alice.page.reload();
  await expect(alice.page.getByRole("heading", { name: "Ciao Alice 👋" })).toBeVisible();

  await switchLanguage(alice, "English");
  await expect(alice.page.getByRole("heading", { name: "Hey Alice 👋" })).toBeVisible();
  await expect(alice.page.locator("html")).toHaveAttribute("lang", "en");
});

test("switching language mid-match relabels the game in place", async ({ startMatch }) => {
  const {
    players: [x],
  } = await startMatch("tictactoe");
  await expect(x.page.getByText("Your turn — place your X.")).toBeVisible();

  await switchLanguage(x, "Italiano");
  await expect(x.page.getByRole("heading", { name: "Tris" })).toBeVisible();
  await expect(x.page.getByText("Tocca a te: metti la tua X.")).toBeVisible();
  await expect(
    x.page.getByRole("button", { name: "Riga 2, colonna 2, vuota: metti la tua X" }),
  ).toBeEnabled();
});

test.describe("in a browser set to Italian", () => {
  test.use({ locale: "it-IT" });

  test("the app opens in Italian", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "it");

    await page.getByRole("button", { name: "Giochiamo" }).click();
    await expect(page.getByText("Inserisci un nickname per continuare.")).toBeVisible();

    await page.getByRole("textbox", { name: "Scegli un nickname" }).fill("Alice");
    await page.getByRole("button", { name: "Giochiamo" }).click();
    await expect(page.getByRole("heading", { name: "Ciao Alice 👋" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Inizia una nuova partita a Dama/ }),
    ).toBeEnabled();
  });
});
