import { expect, test, uniqueNickname } from "./fixtures";
import type { Player } from "./fixtures";

// The language menu, in the profile popup with the player's other settings. Its accessible name
// says which language is showing, in that language.
function languageMenu(player: Player) {
  return player.page.getByRole("button", { name: /^(Language|Lingua): / });
}

// Opens the profile popup, picks `to` there, and closes the popup again — the page behind an
// open popup is hidden from assistive technology, and so from these specs' role queries.
async function switchLanguage(player: Player, to: string) {
  await player.page.getByRole("button", { name: /^(Signed in as|Sei entrato come) / }).click();
  await languageMenu(player).click();
  await player.page.getByRole("menuitemradio", { name: to }).click();
  // The control names the new language in that language, and the popup stays open for it.
  await expect(languageMenu(player)).toHaveAccessibleName(new RegExp(`: ${to}$`));
  // Focus comes back to the button once the menu has finished closing. Until then the menu is
  // still the topmost overlay, and an Escape would go to it rather than to the popup.
  await expect(languageMenu(player)).toBeFocused();
  await player.page.keyboard.press("Escape");
  await expect(languageMenu(player)).toBeHidden();
}

test("a player can switch to Italian, and it sticks", async ({ newPlayer }) => {
  const alice = await newPlayer("Alice");
  const hey = `Hey ${alice.nickname} 👋`;
  const ciao = `Ciao ${alice.nickname} 👋`;
  await alice.page.goto("/");
  await expect(alice.page.getByRole("heading", { name: hey })).toBeVisible();

  await switchLanguage(alice, "Italiano");
  await expect(alice.page.getByRole("heading", { name: ciao })).toBeVisible();
  await expect(alice.page.locator("html")).toHaveAttribute("lang", "it");

  await alice.page.reload();
  await expect(alice.page.getByRole("heading", { name: ciao })).toBeVisible();

  await switchLanguage(alice, "English");
  await expect(alice.page.getByRole("heading", { name: hey })).toBeVisible();
  await expect(alice.page.locator("html")).toHaveAttribute("lang", "en");
});

test("switching language mid-match relabels the game in place", async ({ startMatch }) => {
  const {
    players: [x],
  } = await startMatch("tictactoe");
  await expect(x.page.getByText("Your turn — place your X.")).toBeVisible();

  await switchLanguage(x, "Italiano");
  // The page's title; the game's panel carries the name again, as a smaller heading.
  await expect(x.page.getByRole("heading", { name: "Tris", level: 1 })).toBeVisible();
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

    const nickname = uniqueNickname("Alice");
    await page.getByRole("textbox", { name: "Scegli un nickname" }).fill(nickname);
    await page.getByRole("button", { name: "Giochiamo" }).click();
    await expect(page.getByRole("heading", { name: `Ciao ${nickname} 👋` })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Inizia una nuova partita a Dama/ }),
    ).toBeEnabled();
  });
});
