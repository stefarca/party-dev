import { createMatch, expect, joinMatch, test, uniqueNickname } from "./fixtures";

// The lobby is the same for every game; these use tic-tac-toe as the simplest one to fill.

test("the host opens a lobby from the shelf, and a guest joins with its code", async ({
  newPlayer,
}) => {
  const [alice, bob] = await Promise.all([newPlayer("Alice"), newPlayer("Bob")]);

  await alice.page.goto("/");
  await alice.page.getByRole("button", { name: "Start a new Tic-tac-toe match" }).click();
  await expect(alice.page).toHaveURL(/\/m\/[A-Z2-9]{6}$/);
  const code = new URL(alice.page.url()).pathname.slice("/m/".length);

  await expect(alice.page.getByRole("heading", { name: "Invite your crew" })).toBeVisible();
  await expect(alice.page.getByText("Open seat")).toBeVisible();
  const start = alice.page.getByRole("button", { name: /^Start match/ });
  await expect(start).toBeDisabled();
  await expect(alice.live).toBeVisible();

  await bob.page.goto("/");
  // Codes are case-insensitive, so a guest can type one in however they heard it.
  await bob.page.getByRole("textbox", { name: "Match code" }).fill(code.toLowerCase());
  await bob.page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(bob.page).toHaveURL(`/m/${code}`);
  await expect(bob.page.getByText("Waiting for the host to start.")).toBeVisible();
  await expect(bob.page.getByRole("button", { name: /^Start match/ })).toHaveCount(0);

  // The host's lobby fills in live.
  await expect(alice.page.getByRole("listitem").filter({ hasText: bob.nickname })).toBeVisible();
  await expect(alice.page.getByText("Open seat")).toHaveCount(0);
  await start.click();

  await expect(alice.yourTurn.or(alice.waitingOn(bob))).toBeVisible();
  await expect(bob.yourTurn.or(bob.waitingOn(alice))).toBeVisible();
});

test("a signed-out guest who opens the match link signs in and lands in the lobby", async ({
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
  await expect(page.getByText("Waiting for the host to start.")).toBeVisible();
  await expect(alice.page.getByRole("listitem").filter({ hasText: bob })).toBeVisible();
  await expect(alice.page.getByRole("button", { name: /^Start match/ })).toBeEnabled();
});

test("a full lobby turns away one more player", async ({ newPlayer }) => {
  const [alice, bob, carol] = await Promise.all(
    ["Alice", "Bob", "Carol"].map((nickname) => newPlayer(nickname)),
  );
  const code = await createMatch(alice, "tictactoe");
  await joinMatch(bob, code);

  await carol.page.goto(`/m/${code}`);
  await expect(carol.page.getByText("This lobby is full.")).toBeVisible();
});

test("a match that has started turns away a latecomer", async ({ startMatch, newPlayer }) => {
  const { code } = await startMatch("tictactoe");
  const carol = await newPlayer("Carol");

  await carol.page.goto(`/m/${code}`);
  await expect(
    carol.page.getByText("This match is already under way and you are not one of its players."),
  ).toBeVisible();
});
