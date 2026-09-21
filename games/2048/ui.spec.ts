import { expect, test } from "../../e2e/fixtures";
import type { Player } from "../../e2e/fixtures";

// The 2048 board, played in a browser. Today's board comes from a seed the
// test cannot know, so these specs never expect a particular tile: they read
// the board from the table a screen reader reads, and check what any board
// must do. e2e/daily.spec.ts covers starting, ending and the chart.

async function startRun(player: Player) {
  await player.page.goto("/daily/2048");
  await player.page.getByRole("button", { name: "Start today's run" }).click();
  await expect(player.page.getByRole("group", { name: "Slide the tiles" })).toBeVisible();
}

// The board, row by row, as the hidden table reads it: a number, or "empty".
function cells(player: Player) {
  return player.page.getByRole("table", { name: "Board" }).getByRole("cell");
}

// The "Moves" figure above the board.
function moves(player: Player) {
  return player.page.getByRole("definition").filter({ hasText: "Moves" });
}

async function moveCount(player: Player): Promise<number> {
  const text = (await moves(player).textContent()) ?? "";
  return Number(text.replace(/\D/g, ""));
}

test("everyone starts today from the same board", async ({ newPlayer }) => {
  const [ada, bob] = await Promise.all([newPlayer("Ada"), newPlayer("Bob")]);
  await startRun(ada);
  await startRun(bob);

  await expect(cells(ada)).toHaveCount(16);
  const board = await cells(ada).allTextContents();
  expect(board.filter((cell) => cell !== "empty")).toHaveLength(2);
  expect(await cells(bob).allTextContents()).toEqual(board);
});

test("the arrow keys slide the tiles, and so do the buttons", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);
  await expect(moves(ada)).toHaveText(/Moves\s*0/);

  // With tiles on the board and room to move, at least one of the four
  // directions always changes something; a blocked one is simply ignored.
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
    await ada.page.keyboard.press(key);
  }
  await expect.poll(() => moveCount(ada)).toBeGreaterThan(0);
  // Every move that went through spawned one tile, and a merge can only
  // take one away, so the board never shrinks below the two it opened with.
  const tiles = (await cells(ada).allTextContents()).filter((cell) => cell !== "empty");
  expect(tiles.length).toBeGreaterThanOrEqual(2);

  const afterKeys = await moveCount(ada);
  for (const name of ["Slide left", "Slide right", "Slide up", "Slide down"]) {
    await ada.page.getByRole("button", { name }).click();
  }
  await expect.poll(() => moveCount(ada)).toBeGreaterThan(afterKeys);
});

test("a run that is over takes no more moves", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);
  await ada.page.getByRole("button", { name: "End run" }).click();
  await ada.page.getByRole("alertdialog").getByRole("button", { name: "End run" }).click();
  await expect(ada.page.getByText("This run is over.")).toBeVisible();

  const board = await cells(ada).allTextContents();
  for (const name of ["Slide left", "Slide right", "Slide up", "Slide down"]) {
    await expect(ada.page.getByRole("button", { name })).toBeDisabled();
  }
  await ada.page.keyboard.press("ArrowLeft");
  await ada.page.keyboard.press("ArrowUp");
  await expect(moves(ada)).toHaveText(/Moves\s*0/);
  expect(await cells(ada).allTextContents()).toEqual(board);
});
