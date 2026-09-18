import { expect, test } from "../../e2e/fixtures";
import type { Player } from "../../e2e/fixtures";

// A column is one button, named for what pressing it does: "Drop a disc in column 3",
// "Drop a disc in column 3, not your turn", or "Column 3, full". Columns are 1-based.
function column(player: Player, n: number) {
  return player.page.getByRole("button", {
    name: new RegExp(`^(Drop a disc in column ${n}|Column ${n})(,|$)`),
  });
}

// Drops discs alternately, `first` first. See games/tictactoe/ui.spec.ts's `play` for why each
// drop waits for the mover's turn banner to go.
async function play(first: Player, second: Player, columns: number[]) {
  for (const [i, n] of columns.entries()) {
    const mover = i % 2 === 0 ? first : second;
    await column(mover, n).click();
    await expect(mover.yourTurn).toBeHidden();
  }
}

test("a dropped disc shows on both boards, and the turn passes", async ({ startMatch }) => {
  const {
    players: [first, second],
  } = await startMatch("connect4");

  await expect(first.page.getByText("Your turn — pick a column.")).toBeVisible();
  await expect(column(second, 4)).toHaveAccessibleName("Drop a disc in column 4, not your turn");
  await expect(column(second, 4)).toBeDisabled();

  await column(first, 4).click();

  for (const player of [first, second]) {
    await expect(column(player, 4).getByRole("img")).toHaveAccessibleName(/disc \(last move\)$/);
  }
  await expect(second.yourTurn).toBeVisible();
  await expect(column(second, 4)).toHaveAccessibleName("Drop a disc in column 4");
  await expect(column(first, 4)).toBeDisabled();
});

test("four in a column wins", async ({ startMatch }) => {
  const {
    players: [first, second],
  } = await startMatch("connect4");

  await play(first, second, [1, 2, 1, 2, 1, 2, 1]);

  await expect(first.page.getByText("You won!")).toBeVisible();
  await expect(second.page.getByText(`${first.nickname} won.`)).toBeVisible();
  await expect(column(second, 3)).toBeDisabled();
  await expect(column(first, 3)).toBeDisabled();
});

test("a full column takes no more discs", async ({ startMatch }) => {
  const {
    players: [first, second],
  } = await startMatch("connect4");

  // Six alternating discs fill column 1 without lining up four of anyone's.
  await play(first, second, [1, 1, 1, 1, 1, 1]);

  for (const player of [first, second]) {
    await expect(column(player, 1)).toHaveAccessibleName("Column 1, full");
    await expect(column(player, 1)).toBeDisabled();
    await expect(column(player, 1).getByRole("img")).toHaveCount(6);
  }
  // It is `first`'s turn again, and every other column still takes a disc.
  await expect(first.yourTurn).toBeVisible();
  await expect(column(first, 2)).toBeEnabled();
});
