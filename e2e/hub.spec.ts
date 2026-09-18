import { createMatch, expect, test } from "./fixtures";

test("a new visitor picks a nickname and stays signed in", async ({ page }) => {
  await page.goto("/");

  const letsPlay = page.getByRole("button", { name: "Let's play" });
  await letsPlay.click();
  await expect(page.getByText("Enter a nickname to continue.")).toBeVisible();

  await page.getByRole("textbox", { name: "Pick a nickname" }).fill("Alice");
  await letsPlay.click();
  await expect(page.getByRole("heading", { name: "Hey Alice 👋" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Hey Alice 👋" })).toBeVisible();
});

test("a player can change their nickname", async ({ newPlayer }) => {
  const alice = await newPlayer("Alice");
  await alice.page.goto("/");

  await alice.page.getByRole("button", { name: "Signed in as Alice. Change nickname" }).click();
  await alice.page.getByRole("textbox", { name: "Nickname" }).fill("Alicia");
  await alice.page.getByRole("button", { name: "Save" }).click();

  await expect(alice.page.getByRole("heading", { name: "Hey Alicia 👋" })).toBeVisible();
  await expect(
    alice.page.getByRole("button", { name: "Signed in as Alicia. Change nickname" }),
  ).toBeVisible();
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
  await expect(alice.page.getByRole("heading", { name: "Hey Alice 👋" })).toBeVisible();
});
