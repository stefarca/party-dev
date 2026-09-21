import { expect, test } from "../../e2e/fixtures";
import type { Player } from "../../e2e/fixtures";

// The minefield, played in a browser. Today's board comes from a seed the test
// cannot know, so these specs read it from the grid's accessible names, the
// same way a screen reader does, and work out which squares are safe the way
// a player does. Every board can be cleared without a guess, so that always
// finds one. e2e/daily.spec.ts covers starting, ending and the chart.

const COLS = 10;
const ROWS = 12;

async function startRun(player: Player) {
  await player.page.goto("/daily/minesweeper");
  await player.page.getByRole("button", { name: "Start today's run" }).click();
  await expect(grid(player)).toBeVisible();
}

function grid(player: Player) {
  return player.page.getByRole("grid", { name: "Minefield" });
}

// The square at `index`, in reading order. Found by position rather than by
// name, since its name changes with what it shows.
function square(player: Player, index: number) {
  return grid(player).getByRole("gridcell").nth(index);
}

function stat(player: Player, name: string) {
  return player.page.getByRole("definition").filter({ hasText: name });
}

type Seen = number | "hidden" | "flag" | "mine";

// Every square in reading order, as its name reads: "Row 1, column 3: 2 mines
// nearby", "Row 1, column 4: hidden", "Row 1, column 5: clear".
async function readBoard(player: Player): Promise<Seen[]> {
  const names = await grid(player)
    .getByRole("gridcell")
    .evaluateAll((cells) => cells.map((cell) => cell.getAttribute("aria-label") ?? ""));
  return names.map((name): Seen => {
    const content = name.slice(name.indexOf(": ") + 2);
    if (content === "hidden") return "hidden";
    if (content === "flagged") return "flag";
    if (content === "mine") return "mine";
    if (content === "clear") return 0;
    const match = content.match(/^(\d) mines? nearby$/);
    if (!match) throw new Error(`cannot read the square "${name}"`);
    return Number(match[1]);
  });
}

function around(index: number): number[] {
  const row = Math.floor(index / COLS);
  const col = index % COLS;
  const out: number[] = [];
  for (let r = row - 1; r <= row + 1; r++) {
    for (let c = col - 1; c <= col + 1; c++) {
      if ((r !== row || c !== col) && r >= 0 && r < ROWS && c >= 0 && c < COLS) {
        out.push(r * COLS + c);
      }
    }
  }
  return out;
}

// What a player can tell from `board`, given the mines already worked out:
// squares that must be safe and squares that must be mines. A number with
// all its mines found, or with only mines left around it; then two numbers
// that share squares; then, once every mine is found, whatever is left.
function deduce(board: Seen[], mines: Set<number>, total: number) {
  const shut = (index: number) => typeof board[index] !== "number" && !mines.has(index);
  const safe = new Set<number>();
  const mined = new Set<number>();
  const rules: { cells: number[]; need: number }[] = [];
  board.forEach((seen, index) => {
    if (typeof seen !== "number" || seen === 0) return;
    const cells = around(index).filter(shut);
    if (cells.length === 0) return;
    const need = seen - around(index).filter((other) => mines.has(other)).length;
    if (need === 0) cells.forEach((cell) => safe.add(cell));
    else if (need === cells.length) cells.forEach((cell) => mined.add(cell));
    rules.push({ cells, need });
  });
  if (safe.size === 0 && mined.size === 0) {
    for (const a of rules) {
      for (const b of rules) {
        const shared = b.cells.filter((cell) => a.cells.includes(cell)).length;
        const onlyB = b.cells.filter((cell) => !a.cells.includes(cell));
        if (a === b || shared === 0 || onlyB.length === 0) continue;
        const least = Math.max(0, a.need - (a.cells.length - shared), b.need - onlyB.length);
        const most = Math.min(shared, a.need, b.need);
        if (b.need - least === 0) onlyB.forEach((cell) => safe.add(cell));
        else if (b.need - most === onlyB.length) onlyB.forEach((cell) => mined.add(cell));
      }
    }
  }
  if (safe.size === 0 && mined.size === 0 && mines.size === total) {
    board.forEach((_, index) => {
      if (shut(index)) safe.add(index);
    });
  }
  return { safe: [...safe], mined: [...mined] };
}

// The mines on today's board, read off the Mines counter before any flag is
// planted.
async function mineCount(player: Player): Promise<number> {
  const text = (await stat(player, "Mines").textContent()) ?? "";
  return Number(text.replace(/\D/g, ""));
}

// Works through the board by deduction, opening one proven-safe square at a
// time and waiting for it to open before looking again, until `done` says to
// stop. Returns the mines it worked out.
async function sweep(
  player: Player,
  done: (board: Seen[], mines: Set<number>) => boolean,
): Promise<Set<number>> {
  const total = await mineCount(player);
  const mines = new Set<number>();
  for (;;) {
    const board = await readBoard(player);
    if (done(board, mines)) return mines;
    const { safe, mined } = deduce(board, mines, total);
    mined.forEach((cell) => mines.add(cell));
    if (safe.length === 0) {
      if (mined.length > 0) continue;
      throw new Error("stuck: today's board needs a guess");
    }
    await square(player, safe[0]).click();
    await expect(square(player, safe[0])).not.toHaveAccessibleName(/: hidden$/);
  }
}

// Moves the grid's selection from `from` to `to` with the arrow keys.
async function walk(player: Player, from: number, to: number) {
  const rows = Math.floor(to / COLS) - Math.floor(from / COLS);
  const cols = (to % COLS) - (from % COLS);
  for (let i = 0; i < Math.abs(rows); i++) {
    await player.page.keyboard.press(rows > 0 ? "ArrowDown" : "ArrowUp");
  }
  for (let i = 0; i < Math.abs(cols); i++) {
    await player.page.keyboard.press(cols > 0 ? "ArrowRight" : "ArrowLeft");
  }
  await expect(square(player, to)).toBeFocused();
  await expect(square(player, to)).toHaveAttribute("aria-selected", "true");
}

test("everyone starts today from the same opening", async ({ newPlayer }) => {
  const [ada, bob] = await Promise.all([newPlayer("Ada"), newPlayer("Bob")]);
  await startRun(ada);
  await startRun(bob);

  await expect(grid(ada).getByRole("gridcell")).toHaveCount(COLS * ROWS);
  const board = await readBoard(ada);
  const open = board.filter((seen) => typeof seen === "number");
  // The opening is a clearing: at least one square with no mine around it,
  // ringed by numbers, and nothing else open yet.
  expect(open).toContain(0);
  expect(open.some((seen) => seen !== 0)).toBe(true);
  expect(board.every((seen) => seen === "hidden" || typeof seen === "number")).toBe(true);
  expect(await readBoard(bob)).toEqual(board);
  expect(await mineCount(ada)).toBe(20);
  await expect(stat(ada, "Moves")).toHaveText(/Moves\s*0/);
});

test("a flag goes up by right-click, long press or the Flag switch", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);
  const board = await readBoard(ada);
  const [first, second] = board.flatMap((seen, index) => (seen === "hidden" ? [index] : []));

  await square(ada, first).click({ button: "right" });
  await expect(square(ada, first)).toHaveAccessibleName(/: flagged$/);
  await expect(stat(ada, "Mines")).toHaveText(/Mines\s*19/);
  await square(ada, first).click({ button: "right" });
  await expect(square(ada, first)).toHaveAccessibleName(/: hidden$/);
  await expect(stat(ada, "Mines")).toHaveText(/Mines\s*20/);

  const flagMode = ada.page.getByRole("button", { name: "Flag" });
  await flagMode.click();
  await expect(flagMode).toHaveAttribute("aria-pressed", "true");
  await square(ada, second).click();
  await expect(square(ada, second)).toHaveAccessibleName(/: flagged$/);

  // A finger held on a square flags it, and the tap the press ends in is
  // spent: in flag mode it would pull the flag straight back up.
  const held = square(ada, first);
  await held.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true });
  await expect(held).toHaveAccessibleName(/: flagged$/);
  await held.dispatchEvent("pointerup", { pointerType: "touch", isPrimary: true });
  await held.dispatchEvent("click");
  // Moves land in order, so once this one has, a stray one on the held
  // square would have too.
  await square(ada, second).click();
  await expect(square(ada, second)).toHaveAccessibleName(/: hidden$/);
  await expect(held).toHaveAccessibleName(/: flagged$/);

  // Outside flag mode, a tap on a flag does not open it.
  await flagMode.click();
  await expect(flagMode).toHaveAttribute("aria-pressed", "false");
  await held.click();
  await square(ada, second).click({ button: "right" });
  await expect(square(ada, second)).toHaveAccessibleName(/: flagged$/);
  await expect(held).toHaveAccessibleName(/: flagged$/);

  // Flags are not moves.
  await expect(stat(ada, "Moves")).toHaveText(/Moves\s*0/);
});

test("the keyboard moves the selection, flags and opens", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);
  const board = await readBoard(ada);
  const total = await mineCount(ada);
  // The first square a player can prove safe, without opening anything yet.
  const mines = new Set<number>();
  let safe: number[] = [];
  while (safe.length === 0) {
    const found = deduce(board, mines, total);
    if (found.safe.length === 0 && found.mined.length === 0) throw new Error("nothing to deduce");
    found.mined.forEach((cell) => mines.add(cell));
    safe = found.safe;
  }
  const target = safe[0];
  const hidden = board.findIndex((seen, index) => seen === "hidden" && index !== target);

  // The first square is the grid's one tab stop.
  await square(ada, 0).focus();
  await walk(ada, 0, hidden);
  await ada.page.keyboard.press("f");
  await expect(square(ada, hidden)).toHaveAccessibleName(/: flagged$/);
  await ada.page.keyboard.press("f");
  await expect(square(ada, hidden)).toHaveAccessibleName(/: hidden$/);

  await walk(ada, hidden, target);
  await ada.page.keyboard.press("Space");
  await expect(square(ada, target)).not.toHaveAccessibleName(/: hidden$/);
  await expect(stat(ada, "Moves")).toHaveText(/Moves\s*1/);
});

test("a mine ends the run, and shows no other", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);
  const [mine] = await sweep(ada, (_, mines) => mines.size > 0);

  await square(ada, mine).click();
  await expect(square(ada, mine)).toHaveAccessibleName(/: mine$/);
  await expect(
    ada.page.getByText("Boom! That was a mine, and this run is over.").first(),
  ).toBeVisible();
  await expect(ada.page.getByRole("heading", { name: "Today's run is over" })).toBeVisible();
  const board = await readBoard(ada);
  expect(board.filter((seen) => seen === "mine")).toHaveLength(1);
  expect(board).toContain("hidden");
  await expect(ada.page.getByRole("button", { name: "Flag" })).toBeDisabled();

  const chart = ada.page.getByRole("list", { name: /^Chart for / });
  const row = chart.getByRole("listitem").filter({ hasText: ada.nickname });
  await expect(row).toContainText(/Boom! \d+ of 100 open/);
  await expect(row).toContainText("No score");
});

test("a run that is over takes no more moves", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);
  await ada.page.getByRole("button", { name: "End run" }).click();
  await ada.page.getByRole("alertdialog").getByRole("button", { name: "End run" }).click();
  await expect(ada.page.getByText("This run is over.")).toBeVisible();

  const hidden = (await readBoard(ada)).indexOf("hidden");
  await square(ada, hidden).click();
  await square(ada, hidden).click({ button: "right" });
  await expect(ada.page.getByRole("button", { name: "Flag" })).toBeDisabled();
  await expect(square(ada, hidden)).toHaveAccessibleName(/: hidden$/);

  const chart = ada.page.getByRole("list", { name: /^Chart for / });
  const mine = chart.getByRole("listitem").filter({ hasText: ada.nickname });
  await expect(mine).toContainText(/\d+ of 100 squares open/);
  await expect(mine).toContainText("No score");
});

test("clearing the board stops the clock and puts the time on the chart", async ({ newPlayer }) => {
  // Every square the sweep opens is a move of its own, and there are dozens.
  test.slow();
  const ada = await newPlayer("Ada");
  await startRun(ada);
  await sweep(ada, (board) => !board.includes("hidden"));

  await expect(ada.page.getByText(/^Cleared in \d+:\d\d!$/).first()).toBeVisible();
  await expect(ada.page.getByRole("heading", { name: "Today's run is over" })).toBeVisible();
  await expect(ada.page.getByText(/^You scored \d+:\d\d\.$/)).toBeVisible();
  // Every mine shows as found.
  expect((await readBoard(ada)).filter((seen) => seen === "flag")).toHaveLength(20);
  await expect(stat(ada, "Mines")).toHaveText(/Mines\s*0/);

  const moves = Number(((await stat(ada, "Moves").textContent()) ?? "").replace(/\D/g, ""));
  const chart = ada.page.getByRole("list", { name: /^Chart for / });
  const mine = chart.getByRole("listitem").filter({ hasText: ada.nickname });
  await expect(mine).toContainText(`Cleared in ${moves} moves`);
  await expect(mine).toContainText(/\d+:\d\d/);
});
