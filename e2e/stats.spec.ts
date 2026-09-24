import { createMatch, expect, joinMatch, test } from "./fixtures";
import type { Player } from "./fixtures";

// The stats page and the hub's streaks, from matches played to the end. The matches are played
// over the HTTP API: what is under test is what a finished match adds up to, and tic-tac-toe's
// board has a spec of its own.

// Cells in the order they are played, X first. Either way X opens in the top row and O answers
// in the middle one; whoever is to win completes their row.
const X_WINS = [0, 3, 1, 4, 2];
const O_WINS = [0, 3, 1, 4, 8, 5];

async function playToAWin(winner: Player, loser: Player): Promise<void> {
  const code = await createMatch(winner, "tictactoe");
  await joinMatch(loser, code);
  const started = await winner.context.request.post(`/api/matches/${code}/start`, { data: {} });
  await expect(started).toBeOK();
  // Who plays X is drawn when the match starts.
  const { waitingOn } = (await started.json()) as { waitingOn: string[] };
  const winnerIsX = waitingOn.includes(winner.id);
  const [x, o] = winnerIsX ? [winner, loser] : [loser, winner];
  for (const [i, cell] of (winnerIsX ? X_WINS : O_WINS).entries()) {
    const mover = i % 2 === 0 ? x : o;
    const res = await mover.context.request.post(`/api/matches/${code}/actions`, {
      data: { action: { t: "place", cell } },
    });
    await expect(res, `${mover.nickname} plays cell ${cell}`).toBeOK();
  }
}

test("finished matches add up to streaks and a rivalry on both sides", async ({ newPlayer }) => {
  const [ada, bob] = await Promise.all([newPlayer("Ada"), newPlayer("Bob")]);
  await playToAWin(ada, bob);
  await playToAWin(ada, bob);

  // Both moved today, so both have a play streak; only Ada has a win streak.
  await ada.page.goto("/");
  await expect(ada.page.getByText("1-day streak")).toBeVisible();
  await expect(ada.page.getByText("2 wins in a row")).toBeVisible();

  await ada.page.getByRole("link", { name: "Stats & rivals ▸" }).click();
  await expect(ada.page).toHaveURL(/\/stats$/);
  await expect(ada.page.getByRole("heading", { name: "Your stats" })).toBeVisible();

  const streaks = ada.page.getByRole("region", { name: "Your streaks" });
  await expect(
    streaks.getByText("Done for today. Come back tomorrow to keep it going."),
  ).toBeVisible();
  await expect(streaks.getByText("2 wins", { exact: true })).toBeVisible();

  const rivals = ada.page.getByRole("list", { name: "Rivalries" });
  await expect(rivals.getByText(`You're 2–0 against ${bob.nickname}`)).toBeVisible();
  await expect(rivals.getByText("Favourite victim")).toBeVisible();
  await expect(rivals.getByText("Tic-tac-toe: 2–0")).toBeVisible();

  const byGame = ada.page.getByRole("table", { name: "Your record by game" });
  await expect(byGame.getByRole("row", { name: /Tic-tac-toe/ })).toContainText("100%");

  // The week's boards are everyone's; Ada's wins put at least one name on the champions.
  await expect(ada.page.getByRole("heading", { name: "Champions" })).toBeVisible();
  await expect(ada.page.getByRole("list", { name: "Most wins this week" })).toBeVisible();
  await expect(ada.page.getByRole("heading", { name: "Wall of shame" })).toBeVisible();

  await bob.page.goto("/stats");
  const bobsRivals = bob.page.getByRole("list", { name: "Rivalries" });
  await expect(bobsRivals.getByText(`You're 0–2 against ${ada.nickname}`)).toBeVisible();
  await expect(bobsRivals.getByText("Nemesis")).toBeVisible();
  await expect(
    bob.page
      .getByRole("region", { name: "Your streaks" })
      .getByText("Win your next match to start one."),
  ).toBeVisible();
});

test("a player who has not finished a match is told how to start", async ({ newPlayer }) => {
  const newcomer = await newPlayer("Newcomer");
  await newcomer.page.goto("/stats");

  await expect(newcomer.page.getByText("Make a move or play a daily to start one.")).toBeVisible();
  await expect(
    newcomer.page.getByText(
      "Finish a match against someone and your rivalry with them starts here.",
    ),
  ).toBeVisible();
  await expect(
    newcomer.page.getByText("Play a match and your record shows up here."),
  ).toBeVisible();

  // Back to the hub the way it came.
  await newcomer.page.getByRole("link", { name: "← Hub" }).click();
  await expect(
    newcomer.page.getByRole("heading", { name: `Hey ${newcomer.nickname} 👋` }),
  ).toBeVisible();
});

// The boards' rows carry the longest lines on the page, and a row that will not shrink widens
// the whole page past a phone's screen.
test("the stats page fits a phone's width", async ({ newPlayer }) => {
  const width = 375;
  const [ada, bob] = await Promise.all([
    newPlayer("Ada", { viewport: { width, height: 740 } }),
    newPlayer("Bob"),
  ]);
  await playToAWin(bob, ada);

  await ada.page.goto("/stats");
  await expect(ada.page.getByRole("list", { name: "Rivalries" })).toBeVisible();
  await expect(
    ada.page.getByRole("list", { name: "Who kept everyone waiting longest this week" }),
  ).toBeVisible();
  expect(await ada.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );
});
