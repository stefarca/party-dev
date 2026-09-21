import listedWords from "naughty-words/en.json" with { type: "json" };

import { createMatch, expect, joinMatch, test, uniqueNickname } from "./fixtures";

test("a new visitor picks a nickname and stays signed in", async ({ page }) => {
  const nickname = uniqueNickname("Alice");
  await page.goto("/");

  const letsPlay = page.getByRole("button", { name: "Let's play" });
  await letsPlay.click();
  await expect(page.getByText("Enter a nickname to continue.")).toBeVisible();

  await page.getByRole("textbox", { name: "Pick a nickname" }).fill(nickname);
  await letsPlay.click();
  await expect(page.getByRole("heading", { name: `Hey ${nickname} 👋` })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: `Hey ${nickname} 👋` })).toBeVisible();
});

// The nickname filter runs only in the Worker, so the gate learns of a refusal from the error.
test("a refused nickname keeps the gate up", async ({ page }) => {
  // Taken from the filter's own word list. No uniqueNickname(): a refused nickname never becomes
  // an account.
  const refused = listedWords.find((word) => /^[a-z]{4,12}$/.test(word)) ?? "";
  await page.goto("/");

  await page.getByRole("textbox", { name: "Pick a nickname" }).fill(refused);
  await page.getByRole("button", { name: "Let's play" }).click();

  await expect(page.getByText("That nickname isn't one we can hand out.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Pick a nickname" })).toBeVisible();
});

// The nickname is the account: the same one in a second browser is the same player, with the
// matches and the record that go with it. This is the whole reason nicknames are unique.
test("the same nickname in another browser is the same player", async ({ newPlayer, browser }) => {
  const alice = await newPlayer("Alice");
  const bob = await newPlayer("Bob");
  const code = await createMatch(alice, "tictactoe");
  await joinMatch(bob, code);

  const secondDevice = await browser.newContext();
  try {
    const page = await secondDevice.newPage();
    await page.goto("/");
    await page.getByRole("textbox", { name: "Pick a nickname" }).fill(alice.nickname);
    await page.getByRole("button", { name: "Let's play" }).click();

    await expect(page.getByRole("heading", { name: `Hey ${alice.nickname} 👋` })).toBeVisible();
    // Alice's match followed her here, and so did the record it counts towards.
    await expect(page.getByRole("tabpanel").getByRole("link")).toContainText(bob.nickname);
    await expect(page.getByText("1 played")).toBeVisible();
  } finally {
    await secondDevice.close();
  }
});

// Renaming moves your own player; it never signs you into someone else's.
test("a nickname someone else holds is refused", async ({ newPlayer }) => {
  const [alice, bob] = await Promise.all([newPlayer("Alice"), newPlayer("Bob")]);
  await bob.page.goto("/");

  await bob.page
    .getByRole("button", { name: `Signed in as ${bob.nickname}. Profile and settings` })
    .click();
  await bob.page.getByRole("textbox", { name: "Nickname" }).fill(alice.nickname);
  await bob.page.getByRole("button", { name: "Save" }).click();

  await expect(bob.page.getByRole("alert")).toContainText("belongs to someone else");
  await expect(bob.page.getByRole("heading", { name: `Hey ${bob.nickname} 👋` })).toBeVisible();
});

// Signing out is the only way to hand the device to a different player.
test("signing out returns to the nickname gate", async ({ newPlayer }) => {
  const alice = await newPlayer("Alice");
  await alice.page.goto("/");

  await alice.page
    .getByRole("button", { name: `Signed in as ${alice.nickname}. Profile and settings` })
    .click();
  await alice.page.getByRole("button", { name: "Sign out" }).click();

  await expect(alice.page.getByRole("textbox", { name: "Pick a nickname" })).toBeVisible();
  await alice.page.reload();
  await expect(alice.page.getByRole("textbox", { name: "Pick a nickname" })).toBeVisible();
});

test("a player can change their nickname", async ({ newPlayer }) => {
  const alice = await newPlayer("Alice");
  const renamed = uniqueNickname("Alicia");
  await alice.page.goto("/");

  await alice.page
    .getByRole("button", { name: `Signed in as ${alice.nickname}. Profile and settings` })
    .click();
  await alice.page.getByRole("textbox", { name: "Nickname" }).fill(renamed);
  await alice.page.getByRole("button", { name: "Save" }).click();

  await expect(alice.page.getByRole("heading", { name: `Hey ${renamed} 👋` })).toBeVisible();
  await expect(
    alice.page.getByRole("button", { name: `Signed in as ${renamed}. Profile and settings` }),
  ).toBeVisible();
});

// The theme is a player setting, so it lives in the profile popup rather than the header, which
// has room for little else at phone width.
test("a player picks the theme from their profile popup", async ({ newPlayer }) => {
  const alice = await newPlayer("Alice");
  await alice.page.goto("/");

  await alice.page
    .getByRole("button", { name: `Signed in as ${alice.nickname}. Profile and settings` })
    .click();
  const theme = alice.page.getByRole("dialog", { name: "Profile and settings" });
  await theme.getByRole("radio", { name: "Light", exact: true }).click();
  await expect(alice.page.locator("html")).toHaveClass(/\blight\b/);
  await theme.getByRole("radio", { name: "Dark", exact: true }).click();
  await expect(alice.page.locator("html")).toHaveClass(/\bdark\b/);

  await alice.page.reload();
  await expect(alice.page.locator("html")).toHaveClass(/\bdark\b/);
});

// A match refers to its players by id and names them from the registry whenever it is read, so a
// rename shows up in every match the player is already in: on the other player's hub, and inside
// the match itself, history included.
test("a rename reaches the matches the player is already in", async ({ startMatch }) => {
  const {
    code,
    players: [first, second],
  } = await startMatch("tictactoe");
  const renamed = uniqueNickname("Renamed");

  await first.page.goto("/");
  await first.page
    .getByRole("button", { name: `Signed in as ${first.nickname}. Profile and settings` })
    .click();
  await first.page.getByRole("textbox", { name: "Nickname" }).fill(renamed);
  await first.page.getByRole("button", { name: "Save" }).click();
  await expect(first.page.getByRole("heading", { name: `Hey ${renamed} 👋` })).toBeVisible();

  await second.page.goto("/");
  const card = second.page.getByRole("tabpanel").getByRole("link");
  await expect(card).toContainText(renamed);
  await expect(card).not.toContainText(first.nickname);

  await second.page.goto(`/m/${code}`);
  await second.page.getByRole("button", { name: /^History/ }).click();
  const history = second.page.getByRole("list", { name: "History" }).getByRole("listitem");
  await expect(history.filter({ hasText: `${renamed} joined` })).toBeVisible();
  await expect(history.filter({ hasText: `${first.nickname} joined` })).toHaveCount(0);
});

// Resetting the record starts the numbers over and deletes nothing: the match it counted is still
// on the hub, and the reset belongs to the account rather than to this browser.
test("a player can reset their record and keep their matches", async ({ newPlayer }) => {
  const [alice, bob] = await Promise.all([newPlayer("Alice"), newPlayer("Bob")]);
  const code = await createMatch(alice, "tictactoe");
  await joinMatch(bob, code);
  await alice.page.goto("/");
  await expect(alice.page.getByText("1 played")).toBeVisible();

  await alice.page.getByRole("button", { name: "Reset your record" }).click();
  const dialog = alice.page.getByRole("alertdialog", { name: "Reset your record?" });
  await dialog.getByRole("button", { name: "Reset record" }).click();
  await expect(dialog).toBeHidden();

  await expect(alice.page.getByText("0 played")).toBeVisible();
  await expect(alice.page.getByText(/^since /)).toBeVisible();
  await expect(alice.page.getByRole("tabpanel").getByRole("link")).toContainText(bob.nickname);

  await alice.page.reload();
  await expect(alice.page.getByText("0 played")).toBeVisible();
});

test("the shelf offers every playable game and greys out shelved ones", async ({ newPlayer }) => {
  const alice = await newPlayer("Alice");
  const res = await alice.context.request.get("/api/games");
  await expect(res).toBeOK();
  const games = (await res.json()) as Array<{ id: string; name: string; comingSoon?: boolean }>;
  expect(games.length).toBeGreaterThan(0);

  await alice.page.goto("/");
  for (const game of games) {
    if (game.comingSoon) {
      await expect(
        alice.page.getByRole("button", { name: `${game.name}, coming soon` }),
      ).toBeDisabled();
      const create = await alice.context.request.post("/api/matches", {
        data: { gameId: game.id },
      });
      expect(create.status(), `the API refuses a new ${game.id} match`).toBe(409);
    } else {
      await expect(
        alice.page.getByRole("button", { name: `Start a new ${game.name} match` }),
      ).toBeEnabled();
    }
  }
});

test("the hub files a match under whoever's move it is", async ({ startMatch }) => {
  const {
    code,
    players: [mover, waiter],
  } = await startMatch("tictactoe");
  await Promise.all([mover.page.goto("/"), waiter.page.goto("/")]);

  await expect(mover.page.getByText("1 match needs your move.")).toBeVisible();
  await expect(mover.page.getByRole("tab", { name: /^Your turn/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const card = mover.page.getByRole("tabpanel").getByRole("link");
  await expect(card).toContainText("Tic-tac-toe");
  await expect(card).toContainText(waiter.nickname);
  await expect(card).toContainText("Your move");

  // Nothing is waiting on the other player, so their hub opens on the tab that has the match.
  await expect(waiter.page.getByText("Nothing needs your move.")).toBeVisible();
  await expect(waiter.page.getByRole("tab", { name: /^Their turn/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(waiter.page.getByRole("tabpanel").getByRole("link")).toContainText(mover.nickname);

  await card.click();
  await expect(mover.page).toHaveURL(`/m/${code}`);
  await expect(mover.yourTurn).toBeVisible();
});

test("a code that matches nothing says so, and can be corrected", async ({ newPlayer }) => {
  const [alice, bob] = await Promise.all([newPlayer("Alice"), newPlayer("Bob")]);
  const code = await createMatch(alice, "tictactoe");
  await bob.page.goto("/");

  const codeBox = bob.page.getByRole("textbox", { name: "Match code" });
  const join = bob.page.getByRole("button", { name: "Join", exact: true });
  await codeBox.fill("ZZZZ99");
  await join.click();
  await expect(bob.page.getByText("No match with that code.")).toBeVisible();
  await expect(bob.page).toHaveURL("/");

  await codeBox.fill(code);
  await join.click();
  await expect(bob.page).toHaveURL(`/m/${code}`);
});

test("a link to nowhere offers a way back to the hub", async ({ newPlayer }) => {
  const alice = await newPlayer("Alice");
  await alice.page.goto("/nowhere");

  await expect(alice.page.getByRole("heading", { name: "Nothing here" })).toBeVisible();
  await alice.page.getByRole("button", { name: "Back to the hub" }).click();
  await expect(alice.page.getByRole("heading", { name: `Hey ${alice.nickname} 👋` })).toBeVisible();
});
