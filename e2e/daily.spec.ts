import { devices } from "@playwright/test";

import { expect, test } from "./fixtures";
import type { Player } from "./fixtures";

// The daily games' shell: the hub's tile, starting a run, ending it, and the
// chart. It is the same for every daily game, so it is driven here through
// 2048 alone; each game's own ui.spec.ts covers its board.
//
// Every spec signs in players of its own, but the day and its chart are
// shared by every run of the suite that day, so nothing here assumes who else
// is on the chart. A player's own run is always shown, wherever it placed.

function dailyTile(player: Player) {
  return player.page.getByRole("link", { name: /^2048, today's daily challenge/ });
}

async function startRun(player: Player) {
  await player.page.goto("/daily/2048");
  await player.page.getByRole("button", { name: "Start today's run" }).click();
  await expect(player.page.getByRole("group", { name: "Slide the tiles" })).toBeVisible();
}

async function endRun(player: Player) {
  await player.page.getByRole("button", { name: "End run" }).click();
  const dialog = player.page.getByRole("alertdialog");
  await expect(dialog.getByText("End today's run?")).toBeVisible();
  await dialog.getByRole("button", { name: "End run" }).click();
  await expect(player.page.getByRole("heading", { name: "Today's run is over" })).toBeVisible();
}

test("the hub offers today's run, which starts from the game's own page", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await ada.page.goto("/daily");

  // Nothing played today, so the tab bar marks the daily games until something is.
  await expect(ada.page.getByRole("link", { name: "Daily, not played today" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(dailyTile(ada)).toHaveAccessibleName(/Your run is waiting/);
  await expect(ada.page.getByText(/^0 of \d+ played$/)).toBeVisible();
  await dailyTile(ada).click();
  await expect(ada.page).toHaveURL(/\/daily\/2048$/);
  await expect(ada.page.getByRole("heading", { name: "2048", level: 1 })).toBeVisible();
  // Nothing is spent by opening the page: the run starts on the button.
  await expect(ada.page.getByRole("heading", { name: "Today's board" })).toBeVisible();

  await ada.page.getByRole("button", { name: "Start today's run" }).click();
  await expect(ada.page.getByRole("group", { name: "Slide the tiles" })).toBeVisible();
  await expect(ada.page.getByRole("button", { name: "End run" })).toBeVisible();

  await ada.page.getByRole("link", { name: "← Hub" }).click();
  await expect(ada.page).toHaveURL("/daily");
  await expect(dailyTile(ada)).toHaveAccessibleName(/Your run is under way/);
  await expect(ada.page.getByRole("link", { name: "Daily", exact: true })).toBeVisible();
});

// On a phone each daily game is a row, in a list that scrolls under the tab bar that sits over
// the bottom of the page. However many games there are, the page scrolls far enough to bring
// the last one out from under it.
test("on a phone the last daily game scrolls clear of the tab bar", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada", devices["iPhone 15"]);
  await ada.page.goto("/daily");

  const tiles = ada.page.getByRole("link", { name: /today's daily challenge/ });
  await expect(tiles.first()).toBeVisible();
  expect(await tiles.count()).toBeGreaterThan(1);
  // Each tile flies in from below, one after another, so where they are only
  // means anything once that has played out.
  await tiles.evaluateAll((els) =>
    Promise.all(els.flatMap((el) => el.getAnimations().map((a) => a.finished))),
  );

  await ada.page.evaluate(() =>
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
  );
  const nav = await ada.page.getByRole("navigation", { name: "Hub" }).boundingBox();
  const last = await tiles.last().boundingBox();
  expect(nav, "the tab bar is laid out").not.toBeNull();
  expect(last, "the last daily tile is laid out").not.toBeNull();
  expect(last!.y).toBeGreaterThanOrEqual(0);
  expect(last!.y + last!.height).toBeLessThanOrEqual(nav!.y);
});

test("an ended run goes on the chart, and there is no second one today", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);
  await endRun(ada);

  await expect(ada.page.getByText("You scored 0.")).toBeVisible();
  const chart = ada.page.getByRole("list", { name: /^Chart for / });
  const mine = chart.getByRole("listitem").filter({ hasText: ada.nickname });
  await expect(mine).toContainText("you");
  await expect(mine).toContainText("0 moves");

  // The board stays, spent.
  await expect(ada.page.getByRole("button", { name: "Slide left" })).toBeDisabled();

  await ada.page.reload();
  await expect(ada.page.getByRole("heading", { name: "Today's run is over" })).toBeVisible();
  await expect(ada.page.getByRole("button", { name: "Start today's run" })).toHaveCount(0);

  // Starting again hands back the same, finished run.
  const again = await ada.context.request.post("/api/daily/2048/start", { data: {} });
  await expect(again).toBeOK();
  expect(((await again.json()) as { run: { status: string } }).run.status).toBe("done");

  await ada.page.goto("/daily");
  await expect(dailyTile(ada)).toHaveAccessibleName(/You scored 0/);
  await expect(ada.page.getByText(/^1 of \d+ played$/)).toBeVisible();
  // What is still to play comes first, so the finished run goes to the end.
  await expect(
    ada.page.getByRole("link", { name: /today's daily challenge/ }).last(),
  ).toHaveAccessibleName(/^2048, /);
});

test("the chart steps back through earlier days, never past today", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await ada.page.goto("/daily/2048");
  const previous = ada.page.getByRole("button", { name: "Previous day" });
  const next = ada.page.getByRole("button", { name: "Next day" });

  await expect(next).toBeDisabled();
  await previous.click();
  await expect(next).toBeEnabled();
  await next.click();
  await expect(next).toBeDisabled();
});

test("a move the run cannot take any more is refused where it lands", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);
  // Ended from another device while this page still shows the run going.
  const today = await ada.context.request.get("/api/daily/2048");
  const { day } = (await today.json()) as { day: string };
  await expect(
    await ada.context.request.post(`/api/daily/2048/${day}/finish`, { data: {} }),
  ).toBeOK();

  await ada.page.getByRole("button", { name: "Slide up" }).click();
  await expect(ada.page.getByText("This run is already over.")).toBeVisible();
  await expect(ada.page.getByRole("heading", { name: "Today's run is over" })).toBeVisible();
});

test("practice opens once today's run is over, survives a reload, and counts for nothing", async ({
  newPlayer,
}) => {
  const ada = await newPlayer("Ada");
  const board = ada.page.getByRole("table", { name: "Board" }).getByRole("cell");
  const moves = ada.page.getByRole("definition").filter({ hasText: "Moves" });

  // Before today's run, the practice address only points back to it.
  await ada.page.goto("/daily/2048/practice");
  await expect(ada.page.getByText(/Practice boards open once today's run is over/)).toBeVisible();
  await expect(ada.page.getByRole("group", { name: "Slide the tiles" })).toHaveCount(0);
  await ada.page.getByRole("button", { name: "Go to today's run" }).click();
  await expect(ada.page).toHaveURL(/\/daily\/2048$/);

  await ada.page.getByRole("button", { name: "Start today's run" }).click();
  await expect(ada.page.getByRole("group", { name: "Slide the tiles" })).toBeVisible();
  await endRun(ada);
  const daily = await board.allTextContents();

  await ada.page.getByRole("button", { name: "Play again for fun" }).click();
  await expect(ada.page).toHaveURL(/\/daily\/2048\/practice$/);
  await expect(ada.page.getByRole("heading", { name: "Practice board" })).toBeVisible();
  await expect(ada.page.getByRole("list", { name: /^Chart for / })).toHaveCount(0);
  await expect(moves).toHaveText(/Moves\s*0/);

  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
    await ada.page.keyboard.press(key);
  }
  await expect(moves).not.toHaveText(/Moves\s*0$/);
  const played = await board.allTextContents();
  const movesPlayed = await moves.textContent();
  expect(played).not.toEqual(daily);

  // The board in progress is kept on this device.
  await ada.page.reload();
  await expect(ada.page.getByRole("heading", { name: "Practice board" })).toBeVisible();
  await expect(moves).toHaveText(movesPlayed ?? "");
  expect(await board.allTextContents()).toEqual(played);

  await ada.page.getByRole("button", { name: "New board" }).click();
  await expect(moves).toHaveText(/Moves\s*0/);

  // Nothing of it reached the server: today's run still scored 0.
  await ada.page.getByRole("button", { name: "Today's run" }).click();
  await expect(ada.page.getByText("You scored 0.")).toBeVisible();
  await expect(ada.page.getByRole("button", { name: "Continue practice" })).toBeVisible();
  const today = await ada.context.request.get("/api/daily/2048");
  const { run } = (await today.json()) as { run: { status: string; score: { value: number } } };
  expect(run.status).toBe("done");
  expect(run.score.value).toBe(0);
});
