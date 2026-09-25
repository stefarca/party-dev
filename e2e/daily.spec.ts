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

// On a phone each daily game is a row, so every one of them is on the screen at once, above the
// tab bar that sits over the bottom of the page.
test("on a phone every daily game fits on one screen", async ({ newPlayer }) => {
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

  const nav = await ada.page.getByRole("navigation", { name: "Hub" }).boundingBox();
  expect(nav, "the tab bar is laid out").not.toBeNull();
  for (const tile of await tiles.all()) {
    const box = await tile.boundingBox();
    expect(box, "the daily tile is laid out").not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(nav!.y);
  }
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
