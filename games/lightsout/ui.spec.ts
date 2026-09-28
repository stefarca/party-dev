import { expect, test } from "../../e2e/fixtures";
import type { Player } from "../../e2e/fixtures";

// The Lights Out board, played in a browser. Today's board comes from a seed
// the test cannot know, so these specs read it from the lights' accessible
// names and check what any board must do. e2e/daily.spec.ts covers starting,
// ending and the chart.

const SIZE = 5;

async function startRun(player: Player) {
  await player.page.goto("/daily/lightsout");
  await player.page.getByRole("button", { name: "Start today's run" }).click();
  await expect(lights(player)).toHaveCount(SIZE * SIZE);
}

function grid(player: Player) {
  return player.page.getByRole("grid", { name: "Lights" });
}

function lights(player: Player) {
  return grid(player).getByRole("gridcell");
}

function light(player: Player, cell: number) {
  const row = Math.floor(cell / SIZE) + 1;
  const col = (cell % SIZE) + 1;
  return grid(player).getByRole("gridcell", { name: new RegExp(`^Row ${row}, column ${col}:`) });
}

function stat(player: Player, name: string) {
  return player.page.getByRole("definition").filter({ hasText: name });
}

async function expectPresses(player: Player, count: number) {
  await expect(stat(player, "Presses")).toHaveText(new RegExp(`Presses\\s*${count}$`));
}

async function readPar(player: Player): Promise<number> {
  return Number((await stat(player, "Par").textContent())?.match(/\d+/)?.[0]);
}

// Which lights are on, row by row, as a screen reader hears them.
async function readBoard(player: Player): Promise<boolean[]> {
  const names = await lights(player).evaluateAll((cells) =>
    cells.map((cell) => cell.getAttribute("aria-label") ?? ""),
  );
  return names.map((name) => name.endsWith(": on"));
}

const around = (a: number, b: number) =>
  Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE)) + Math.abs((a % SIZE) - (b % SIZE)) <= 1;

// `board` with `cell` pressed, as the rules say it should come out.
function pressed(board: boolean[], cell: number): boolean[] {
  return board.map((on, other) => (around(cell, other) ? !on : on));
}

// Some presses that turn `board` off, not necessarily the fewest: Gaussian
// elimination over GF(2) on one equation per light, with every press it
// leaves free left unpressed. Written here rather than imported, so the spec
// does not take the game's own solver on trust.
function solveBoard(board: boolean[]): number[] {
  const n = SIZE * SIZE;
  const rows = board.map((on, lit) => [
    ...Array.from({ length: n }, (_, cell) => (around(cell, lit) ? 1 : 0)),
    on ? 1 : 0,
  ]);
  const pivots: number[] = [];
  for (let col = 0; col < n; col++) {
    const top = pivots.length;
    const found = rows.findIndex((row, i) => i >= top && row[col] === 1);
    if (found < 0) continue;
    [rows[top], rows[found]] = [rows[found], rows[top]];
    for (let i = 0; i < n; i++) {
      if (i !== top && rows[i][col] === 1) rows[i] = rows[i].map((v, j) => v ^ rows[top][j]);
    }
    pivots.push(col);
  }
  return pivots.filter((_, r) => rows[r][n] === 1);
}

test("everyone plays the same board today", async ({ newPlayer }) => {
  const [ada, bob] = await Promise.all([newPlayer("Ada"), newPlayer("Bob")]);
  await startRun(ada);
  await startRun(bob);

  const board = await readBoard(ada);
  expect(board.some(Boolean)).toBe(true);
  expect(await readBoard(bob)).toEqual(board);
  expect(await readPar(bob)).toBe(await readPar(ada));
  await expect(ada.page.getByText(/^Turn every light off\./)).toBeVisible();
});

test("a press flips the light and the ones beside it, and a second flips them back", async ({
  newPlayer,
}) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);
  const before = await readBoard(ada);
  await expectPresses(ada, 0);

  const centre = 12;
  await light(ada, centre).click();
  await expectPresses(ada, 1);
  expect(await readBoard(ada)).toEqual(pressed(before, centre));

  await light(ada, centre).click();
  await expectPresses(ada, 2);
  expect(await readBoard(ada)).toEqual(before);
});

test("the arrow keys pick a light and Space presses it", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);
  const before = await readBoard(ada);

  await light(ada, 0).focus();
  await ada.page.keyboard.press("ArrowRight");
  await ada.page.keyboard.press("ArrowDown");
  await expect(light(ada, 6)).toBeFocused();
  await ada.page.keyboard.press("Space");
  await expectPresses(ada, 1);
  expect(await readBoard(ada)).toEqual(pressed(before, 6));
});

test("turning the last light off ends the run and puts it on the chart", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);
  const par = await readPar(ada);
  const presses = solveBoard(await readBoard(ada));

  for (const [i, cell] of presses.entries()) {
    await light(ada, cell).click();
    await expectPresses(ada, i + 1);
  }

  expect((await readBoard(ada)).some(Boolean)).toBe(false);
  const count = presses.length;
  // Shown on the banner, and said again in the line a screen reader hears.
  await expect(
    ada.page.getByText(`Lights out in ${count} ${count === 1 ? "press" : "presses"}!`).first(),
  ).toBeVisible();
  const over = count - par;
  await expect(
    ada.page.getByText(
      over === 0
        ? "Right on par: nobody can do it in fewer."
        : `${over} ${over === 1 ? "press" : "presses"} over par.`,
    ),
  ).toBeVisible();
  await expect(ada.page.getByRole("heading", { name: "Today's run is over" })).toBeVisible();
  await expect(ada.page.getByText(`You scored ${count}.`)).toBeVisible();
  const mine = ada.page
    .getByRole("list", { name: /^Chart for / })
    .getByRole("listitem")
    .filter({ hasText: ada.nickname });
  await expect(mine).toContainText(over === 0 ? "At par, in" : "Solved in");

  // The dark board takes no more presses.
  await light(ada, 12).click();
  await expectPresses(ada, count);
  expect((await readBoard(ada)).some(Boolean)).toBe(false);
});

test("a run that is over takes no more presses", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);
  const before = await readBoard(ada);
  await ada.page.getByRole("button", { name: "End run" }).click();
  await ada.page.getByRole("alertdialog").getByRole("button", { name: "End run" }).click();
  await expect(ada.page.getByText("This run is over.")).toBeVisible();

  await light(ada, 12).click();
  await expectPresses(ada, 0);
  expect(await readBoard(ada)).toEqual(before);
  await expect(grid(ada)).toHaveAttribute("aria-readonly", "true");
});
