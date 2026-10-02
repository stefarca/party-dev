import { createMatch, expect, test, uniqueNickname } from "./fixtures";

// The lobby is the same for every game; these use tic-tac-toe as the simplest one to fill.

test("the host opens a lobby from the shelf, and a guest's join starts the match", async ({
  newPlayer,
}) => {
  const [alice, bob] = await Promise.all([newPlayer("Alice"), newPlayer("Bob")]);

  await alice.page.goto("/play");
  await alice.page.getByRole("button", { name: "Start a new Tic-tac-toe match" }).click();
  await expect(alice.page).toHaveURL(/\/m\/[A-Z2-9]{6}$/);
  const code = new URL(alice.page.url()).pathname.slice("/m/".length);

  await expect(alice.page.getByRole("heading", { name: "Invite your crew" })).toBeVisible();
  await expect(alice.page.getByText("Open seat")).toBeVisible();
  await expect(
    alice.page.getByText(/The match starts as soon as every seat is taken\.$/),
  ).toBeVisible();
  // A game for exactly two has nothing for its host to start.
  await expect(alice.page.getByRole("button", { name: /^Start match/ })).toHaveCount(0);
  await expect(alice.live).toBeVisible();

  await bob.page.goto("/play");
  // Codes are case-insensitive, so a guest can type one in however they heard it.
  await bob.page.getByRole("textbox", { name: "Match code" }).fill(code.toLowerCase());
  await bob.page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(bob.page).toHaveURL(`/m/${code}`);

  // The host's page goes straight from the lobby to the game.
  await expect(alice.yourTurn.or(alice.waitingOn(bob))).toBeVisible();
  await expect(bob.yourTurn.or(bob.waitingOn(alice))).toBeVisible();
});

test("a signed-out guest who opens the match link signs in and lands in the game", async ({
  newPlayer,
  page,
}) => {
  const alice = await newPlayer("Alice");
  const code = await createMatch(alice, "tictactoe");
  await alice.page.goto(`/m/${code}`);
  await expect(alice.live).toBeVisible();

  const bob = uniqueNickname("Bob");
  await page.goto(`/m/${code}`);
  await page.getByRole("textbox", { name: "Pick a nickname" }).fill(bob);
  await page.getByRole("button", { name: "Let's play" }).click();

  await expect(page).toHaveURL(`/m/${code}`);
  await expect(page.getByRole("button", { name: /^Row 1, column 1,/ })).toBeVisible();
  await expect(
    alice.yourTurn.or(alice.page.getByText(`Waiting on ${bob}`, { exact: true })),
  ).toBeVisible();
});

test("a match that has started turns away a latecomer", async ({ startMatch, newPlayer }) => {
  const { code } = await startMatch("tictactoe");
  const carol = await newPlayer("Carol");

  await carol.page.goto(`/m/${code}`);
  await expect(
    carol.page.getByText("This match is already under way and you are not one of its players."),
  ).toBeVisible();
});
