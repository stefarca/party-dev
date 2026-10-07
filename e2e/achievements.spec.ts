import { expect, test } from "./fixtures";

// Achievements: announced the moment a match earns one, once, and listed on the stats page with
// what is left to earn. The match is played over the HTTP API, since what is under test is what
// finishing it adds up to, while the winner watches it from the match page.

// Cells in the order they are played, X first: X completes the top row.
const X_WINS = [0, 3, 1, 4, 2];

test("a win is announced as an achievement once, and listed on the stats page", async ({
  startMatch,
}) => {
  // `players[0]` is whoever the game waits on first, so X.
  const {
    code,
    players: [winner, loser],
  } = await startMatch("tictactoe", ["Ada", "Bob"]);
  for (const [i, cell] of X_WINS.entries()) {
    const mover = i % 2 === 0 ? winner : loser;
    const res = await mover.context.request.post(`/api/matches/${code}/actions`, {
      data: { action: { t: "place", cell } },
    });
    await expect(res, `${mover.nickname} plays cell ${cell}`).toBeOK();
  }

  const toast = winner.page.getByRole("status").filter({ hasText: "Achievement unlocked!" });
  await expect(toast).toBeVisible();
  await expect(toast.getByText("Winner", { exact: true })).toBeVisible();
  await expect(toast.getByText("Win a match", { exact: true })).toBeVisible();
  // Losing a first match earns nothing.
  await expect(loser.page.getByText("Achievement unlocked!")).toHaveCount(0);

  // Told once, for every device: the server now remembers it was said.
  await expect
    .poll(async () => {
      const res = await winner.context.request.get("/api/me/achievements");
      return ((await res.json()) as { seen: Record<string, number> }).seen.winner;
    })
    .toBe(1);

  await toast.getByRole("button", { name: "See all" }).click();
  await expect(winner.page).toHaveURL(/\/stats#achievements$/);
  const list = winner.page.getByRole("list", { name: "Your achievements" });
  const item = list.getByRole("listitem").filter({
    has: winner.page.getByRole("heading", { name: "Winner", exact: true }),
  });
  await expect(item.getByRole("img", { name: "Level 1 of 3" })).toBeVisible();
  await expect(item).toContainText("New");
  // The next tier is what it asks for now.
  await expect(item).toContainText("Win 10 matches");
  await expect(item).toContainText("1 of 10");

  // Loading the app again announces nothing: the list is drawn from the same read the
  // announcement would have come from.
  await winner.page.reload();
  await expect(item.getByRole("img", { name: "Level 1 of 3" })).toBeVisible();
  await expect(winner.page.getByText("Achievement unlocked!")).toHaveCount(0);
});

test("a newcomer sees every achievement still to earn, and how far each is", async ({
  newPlayer,
}) => {
  const newcomer = await newPlayer("Newcomer");
  await newcomer.page.goto("/stats");

  await expect(newcomer.page.getByRole("heading", { name: "Achievements" })).toBeVisible();
  await expect(
    newcomer.page.getByText(
      "0 of 35 unlocked. They're yours for good: resetting your record keeps them.",
    ),
  ).toBeVisible();

  const list = newcomer.page.getByRole("list", { name: "Your achievements" });
  await expect(list.getByRole("listitem")).toHaveCount(14);
  const item = (name: string) =>
    list.getByRole("listitem").filter({
      has: newcomer.page.getByRole("heading", { name, exact: true }),
    });
  await expect(item("Veteran")).toContainText("Finish 10 matches");
  await expect(item("Veteran")).toContainText("0 of 10");
  await expect(item("Veteran").getByRole("img", { name: "Level 0 of 3" })).toBeVisible();
  // One with a single tier has no level to show, and nothing to count towards.
  await expect(item("Stalemate")).toContainText("Finish a match in a draw");
  await expect(item("Stalemate").getByRole("img")).toHaveCount(0);
});

test("the achievements fit a phone's width", async ({ newPlayer }) => {
  const width = 375;
  const player = await newPlayer("Phone", { viewport: { width, height: 740 } });
  await player.page.goto("/stats#achievements");

  await expect(player.page.getByRole("list", { name: "Your achievements" })).toBeVisible();
  expect(
    await player.page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(width);
});
