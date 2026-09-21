import { expect, test } from "../../e2e/fixtures";
import type { Player } from "../../e2e/fixtures";

// The sudoku board, played in a browser. Today's puzzle comes from a seed the
// test cannot know, so these specs read it from the grid's accessible names,
// the same way a screen reader does, and check what any puzzle must do. The
// one that solves it works the solution out for itself. e2e/daily.spec.ts
// covers starting, ending and the chart.

async function startRun(player: Player) {
  await player.page.goto("/daily/sudoku");
  await player.page.getByRole("button", { name: "Start today's run" }).click();
  await expect(grid(player)).toBeVisible();
}

function grid(player: Player) {
  return player.page.getByRole("grid", { name: "Puzzle" });
}

// The square at `index`, in reading order. Found by position rather than by
// name, since its name changes with what it holds.
function square(player: Player, index: number) {
  return grid(player).getByRole("gridcell").nth(index);
}

function padDigit(player: Player, digit: number) {
  return player.page.getByRole("group", { name: "Numbers" }).getByRole("button", {
    name: new RegExp(`^${digit},`),
  });
}

function moves(player: Player) {
  return player.page.getByRole("definition").filter({ hasText: "Moves" });
}

interface Square {
  digit: number;
  given: boolean;
}

// Every square in reading order, as its name reads: "Row 1, column 3: 5,
// given", "Row 1, column 4: 7", "Row 1, column 5: empty".
async function readGrid(player: Player): Promise<Square[]> {
  const names = await grid(player)
    .getByRole("gridcell")
    .evaluateAll((cells) => cells.map((cell) => cell.getAttribute("aria-label") ?? ""));
  return names.map((name) => {
    const match = name.match(/: (\d)(, given)?/);
    return { digit: match ? Number(match[1]) : 0, given: Boolean(match?.[2]) };
  });
}

// A digit a square's row already holds, so entering it there clashes.
function clashingEntry(squares: Square[]): { index: number; digit: number; with: number } {
  for (let index = 0; index < 81; index++) {
    if (squares[index].digit !== 0) continue;
    const row = Math.floor(index / 9);
    for (let col = 0; col < 9; col++) {
      const other = row * 9 + col;
      if (squares[other].given) return { index, digit: squares[other].digit, with: other };
    }
  }
  throw new Error("no row has both a given and an empty square");
}

// Today's solution, by plain backtracking over the givens.
function solve(givens: number[]): number[] {
  const cells = givens.slice();
  const fits = (index: number, digit: number) => {
    const row = Math.floor(index / 9);
    const col = index % 9;
    for (let i = 0; i < 9; i++) {
      if (cells[row * 9 + i] === digit || cells[i * 9 + col] === digit) return false;
    }
    const top = row - (row % 3);
    const left = col - (col % 3);
    for (let r = top; r < top + 3; r++) {
      for (let c = left; c < left + 3; c++) if (cells[r * 9 + c] === digit) return false;
    }
    return true;
  };
  const search = (): boolean => {
    const index = cells.indexOf(0);
    if (index === -1) return true;
    for (let digit = 1; digit <= 9; digit++) {
      if (!fits(index, digit)) continue;
      cells[index] = digit;
      if (search()) return true;
    }
    cells[index] = 0;
    return false;
  };
  if (!search()) throw new Error("today's puzzle has no solution");
  return cells;
}

test("everyone starts today from the same puzzle", async ({ newPlayer }) => {
  const [ada, bob] = await Promise.all([newPlayer("Ada"), newPlayer("Bob")]);
  await startRun(ada);
  await startRun(bob);

  await expect(grid(ada).getByRole("gridcell")).toHaveCount(81);
  const puzzle = await readGrid(ada);
  const givens = puzzle.filter((square) => square.given);
  expect(givens.length).toBeGreaterThanOrEqual(17);
  // Nothing but the givens is filled in yet.
  expect(puzzle.every((square) => square.given || square.digit === 0)).toBe(true);
  expect(await readGrid(bob)).toEqual(puzzle);
});

test("a digit goes into the picked square, and notes go beside it", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);
  const open = (await readGrid(ada)).findIndex((square) => !square.given);
  const target = square(ada, open);

  await target.click();
  await expect(target).toHaveAttribute("aria-selected", "true");
  await ada.page.keyboard.press("4");
  await expect(target).toHaveAccessibleName(/: 4/);
  await expect(moves(ada)).toHaveText(/Moves\s*1/);

  await ada.page.keyboard.press("Backspace");
  await expect(target).toHaveAccessibleName(/: empty$/);
  await expect(moves(ada)).toHaveText(/Moves\s*2/);

  const notes = ada.page.getByRole("button", { name: "Notes" });
  await notes.click();
  await expect(notes).toHaveAttribute("aria-pressed", "true");
  await padDigit(ada, 7).click();
  await expect(target).toHaveAccessibleName(/: empty, notes 7$/);
  await padDigit(ada, 2).click();
  await expect(target).toHaveAccessibleName(/: empty, notes 2 7$/);
  // Notes are not moves.
  await expect(moves(ada)).toHaveText(/Moves\s*2/);

  await ada.page.keyboard.press("n");
  await expect(notes).toHaveAttribute("aria-pressed", "false");
  await padDigit(ada, 9).click();
  await expect(target).toHaveAccessibleName(/: 9/);

  // The arrow keys move the selection, and focus with it.
  await target.press("ArrowRight");
  const next = square(ada, open % 9 === 8 ? open : open + 1);
  await expect(next).toHaveAttribute("aria-selected", "true");
  await expect(next).toBeFocused();
});

test("a clash is flagged on both squares until it is fixed", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);
  const entry = clashingEntry(await readGrid(ada));
  const target = square(ada, entry.index);

  await target.click();
  await ada.page.keyboard.press(String(entry.digit));
  const clash = new RegExp(`clashes with another ${entry.digit}$`);
  await expect(target).toHaveAccessibleName(clash);
  await expect(square(ada, entry.with)).toHaveAccessibleName(clash);

  await ada.page.getByRole("button", { name: "Erase" }).click();
  await expect(target).toHaveAccessibleName(/: empty$/);
  await expect(square(ada, entry.with)).not.toHaveAccessibleName(/clashes/);
});

test("a given square takes no digit", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);
  const puzzle = await readGrid(ada);
  const given = puzzle.findIndex((square) => square.given);
  const target = square(ada, given);
  const name = `: ${puzzle[given].digit}, given`;

  await target.click();
  await expect(padDigit(ada, 1)).toBeDisabled();
  await expect(ada.page.getByRole("button", { name: "Erase" })).toBeDisabled();
  await ada.page.keyboard.press(String((puzzle[given].digit % 9) + 1));
  await ada.page.keyboard.press("Backspace");
  await expect(target).toHaveAccessibleName(new RegExp(`${name}$`));
  await expect(moves(ada)).toHaveText(/Moves\s*0/);
});

test("a run that is over takes no more digits", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);
  await ada.page.getByRole("button", { name: "End run" }).click();
  await ada.page.getByRole("alertdialog").getByRole("button", { name: "End run" }).click();
  await expect(ada.page.getByText("This run is over.")).toBeVisible();

  const open = (await readGrid(ada)).findIndex((square) => !square.given);
  await square(ada, open).click();
  await expect(padDigit(ada, 5)).toBeDisabled();
  await expect(ada.page.getByRole("button", { name: "Notes" })).toBeDisabled();
  await ada.page.keyboard.press("5");
  await expect(square(ada, open)).toHaveAccessibleName(/: empty$/);

  // Unsolved, so unranked: the chart says how far it got instead of a time.
  const chart = ada.page.getByRole("list", { name: /^Chart for / });
  const mine = chart.getByRole("listitem").filter({ hasText: ada.nickname });
  await expect(mine).toContainText(/0 of \d+ squares filled/);
  await expect(mine).toContainText("No score");
});

test("solving the puzzle stops the clock and puts the time on the chart", async ({ newPlayer }) => {
  // Every open square is a move of its own, and there are over forty.
  test.slow();
  const ada = await newPlayer("Ada");
  await startRun(ada);
  const puzzle = await readGrid(ada);
  const solution = solve(puzzle.map((square) => square.digit));
  const open = puzzle.flatMap((square, index) => (square.given ? [] : [index]));

  // Four at a time, then wait for the last of them to land: the page queues
  // only four moves ahead and drops the rest.
  for (let from = 0; from < open.length; from += 4) {
    const batch = open.slice(from, from + 4);
    for (const index of batch) {
      await square(ada, index).click();
      await ada.page.keyboard.press(String(solution[index]));
    }
    const last = batch[batch.length - 1];
    await expect(square(ada, last)).toHaveAccessibleName(new RegExp(`: ${solution[last]}`));
  }

  await expect(ada.page.getByText(/^Solved in \d+:\d\d!$/).first()).toBeVisible();
  await expect(ada.page.getByRole("heading", { name: "Today's run is over" })).toBeVisible();
  await expect(ada.page.getByText(/^You scored \d+:\d\d\.$/)).toBeVisible();
  await expect(padDigit(ada, 1)).toBeDisabled();

  const chart = ada.page.getByRole("list", { name: /^Chart for / });
  const mine = chart.getByRole("listitem").filter({ hasText: ada.nickname });
  await expect(mine).toContainText(`Solved in ${open.length} moves`);
  await expect(mine).toContainText(/\d+:\d\d/);
});
