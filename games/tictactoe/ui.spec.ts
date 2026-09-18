import { expect, test } from "../../e2e/fixtures";
import type { Player } from "../../e2e/fixtures";

// A square as the player sees it: 1-based row and column from the top left, which is how every
// square's accessible name starts.
function square(player: Player, row: number, col: number) {
  return player.page.getByRole("button", { name: new RegExp(`^Row ${row}, column ${col},`) });
}

// Plays [row, col] moves alternately, `x` first. A click waits for its square to enable, which
// happens once that player's snapshot says it is their turn. Waiting for the mover's own turn
// banner to go keeps a page that has not yet seen its last move from moving again.
async function play(x: Player, o: Player, moves: Array<[number, number]>) {
  for (const [i, [row, col]] of moves.entries()) {
    const mover = i % 2 === 0 ? x : o;
    await square(mover, row, col).click();
    await expect(mover.yourTurn).toBeHidden();
  }
}

test("X opens, and the turn passes to O", async ({ startMatch }) => {
  const {
    players: [x, o],
  } = await startMatch("tictactoe");

  await expect(x.yourTurn).toBeVisible();
  await expect(x.page.getByText("Your turn — place your X.")).toBeVisible();
  await expect(o.waitingOn(x)).toBeVisible();
  await expect(square(o, 2, 2)).toBeDisabled();

  await square(x, 2, 2).click();

  await expect(square(o, 2, 2)).toHaveAccessibleName("Row 2, column 2, X, last move");
  await expect(o.page.getByText("Your turn — place your O.")).toBeVisible();
  await expect(square(o, 2, 2)).toBeDisabled();
  await expect(x.waitingOn(o)).toBeVisible();
  await expect(square(x, 1, 1)).toBeDisabled();
});

test("three in a row wins", async ({ startMatch }) => {
  const {
    players: [x, o],
  } = await startMatch("tictactoe");

  await play(x, o, [
    [1, 1],
    [2, 1],
    [1, 2],
    [2, 2],
    [1, 3],
  ]);

  await expect(x.page.getByText("You won!")).toBeVisible();
  await expect(x.page.getByText(`You beat ${o.nickname}.`)).toBeVisible();
  await expect(o.page.getByText("Match finished")).toBeVisible();
  await expect(o.page.getByText(`${x.nickname} won.`)).toBeVisible();
  for (const col of [1, 2, 3]) {
    await expect(square(o, 1, col)).toHaveAccessibleName(/winning line/);
  }
  // The board is spent: no square takes a click, for either player.
  await expect(square(o, 3, 3)).toBeDisabled();
  await expect(square(x, 3, 3)).toBeDisabled();
});

test("a full board with no line is a draw", async ({ startMatch }) => {
  const {
    players: [x, o],
  } = await startMatch("tictactoe");

  // X O X
  // X O O
  // O X X
  await play(x, o, [
    [1, 1],
    [1, 2],
    [1, 3],
    [2, 2],
    [2, 1],
    [2, 3],
    [3, 2],
    [3, 1],
    [3, 3],
  ]);

  await expect(x.page.getByText("It's a draw")).toBeVisible();
  await expect(o.page.getByText("It's a draw")).toBeVisible();
});
