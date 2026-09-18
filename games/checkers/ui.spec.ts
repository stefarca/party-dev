import { expect, test } from "../../e2e/fixtures";
import type { Player } from "../../e2e/fixtures";

// A dark square as `player` sees it: 1-based row and column from the top left of their own
// board, which is how its accessible name starts. Each player has their own pieces at the
// bottom, so blue's board is red's turned half a circle, and the same spot on the table has
// different coordinates for each player.
function square(player: Player, row: number, col: number) {
  return player.page.getByRole("button", { name: new RegExp(`^Row ${row}, column ${col},`) });
}

type At = [row: number, col: number];

// One whole move: pick up the piece on `from` and put it down on `to`. When only one piece can
// move, the board has already picked it up, so `from` is null.
async function move(player: Player, from: At | null, to: At) {
  if (from) await square(player, ...from).click();
  await square(player, ...to).click();
  await expect(player.yourTurn).toBeHidden();
}

test("red opens, and each player sees their own pieces at the bottom", async ({ startMatch }) => {
  const {
    players: [red, blue],
  } = await startMatch("checkers");

  await expect(red.page.getByRole("group", { name: /red at the bottom$/ })).toBeVisible();
  await expect(blue.page.getByRole("group", { name: /blue at the bottom$/ })).toBeVisible();
  for (const player of [red, blue]) {
    await expect(player.page.getByText("12 left")).toHaveCount(2);
  }
  await expect(red.page.getByText("Your turn — pick a piece to move.")).toBeVisible();
  await expect(blue.page.getByText(`Waiting for ${red.nickname}…`)).toBeVisible();

  await square(red, 6, 3).click();
  await expect(square(red, 6, 3)).toHaveAccessibleName(/picked up/);
  await expect(red.page.getByText("Pick where to move.")).toBeVisible();
  await expect(square(red, 5, 2)).toHaveAccessibleName(/move here/);
  await expect(square(red, 5, 4)).toHaveAccessibleName(/move here/);

  await square(red, 5, 4).click();

  // Blue sees the same move from the other side of the table.
  await expect(square(blue, 4, 5)).toHaveAccessibleName(/red man, part of the last move/);
  await expect(square(blue, 3, 6)).toHaveAccessibleName(/empty, part of the last move/);
  await expect(blue.page.getByText("Your turn — pick a piece to move.")).toBeVisible();
  await expect(red.waitingOn(blue)).toBeVisible();
});

test("a capture is mandatory, and takes the jumped piece", async ({ startMatch }) => {
  const {
    players: [red, blue],
  } = await startMatch("checkers");

  // Red steps up the middle and blue steps into its path. Seen from each player's own side,
  // the two moves are the same.
  await move(red, [6, 3], [5, 4]);
  await move(blue, [6, 3], [5, 4]);

  // Red's only legal move is the jump, so its piece is already picked up.
  await expect(red.page.getByText("Pick where to jump.")).toBeVisible();
  await expect(square(red, 5, 4)).toHaveAccessibleName(/red man \(yours\), picked up/);
  await expect(square(red, 3, 6)).toHaveAccessibleName(/jump here/);
  await move(red, null, [3, 6]);

  await expect(square(blue, 5, 4)).toHaveAccessibleName(/empty.*captured on the last move/);
  await expect(blue.page.getByText("11 left")).toBeVisible();
  await expect(blue.page.getByText("12 left")).toBeVisible();

  // Now blue has two ways to take that piece back, so it picks one itself.
  await expect(blue.page.getByText("Your turn — you must jump.")).toBeVisible();
  await expect(square(blue, 7, 2)).toHaveAccessibleName(/can move/);
  await expect(square(blue, 7, 4)).toHaveAccessibleName(/can move/);
  await move(blue, [7, 2], [5, 4]);

  for (const player of [red, blue]) {
    await expect(player.page.getByText("11 left")).toHaveCount(2);
  }
  await expect(square(red, 3, 6)).toHaveAccessibleName(/empty.*captured on the last move/);
  await expect(red.yourTurn).toBeVisible();
});

test("a man that reaches the far row is crowned, and the king can jump backwards", async ({
  startMatch,
}) => {
  const {
    players: [red, blue],
  } = await startMatch("checkers");

  // A trade of men in the middle, then blue moves a man off its back row and leaves red a
  // double jump onto the square it emptied.
  await move(red, [6, 1], [5, 2]);
  await move(blue, [6, 5], [5, 6]);
  await move(red, null, [3, 4]);
  await move(blue, [7, 6], [5, 4]);
  await move(red, [6, 5], [5, 6]);
  await move(blue, [8, 7], [7, 6]);

  // A double jump onto blue's back row. Its second hop is forced, so one click sends both.
  await expect(red.page.getByText("Pick where to jump.")).toBeVisible();
  await move(red, null, [3, 4]);

  await expect(square(red, 1, 2)).toHaveAccessibleName(/red king \(yours\), part of the last move/);
  await expect(square(blue, 8, 7)).toHaveAccessibleName(/red king, part of the last move/);
  await expect(blue.page.getByText("9 left")).toBeVisible();

  // Blue steps in behind the new king, and taking it is red's only move: a jump back down
  // the board, which a man could not make.
  await move(blue, [8, 5], [7, 6]);
  await expect(red.page.getByText("Pick where to jump.")).toBeVisible();
  await expect(square(red, 1, 2)).toHaveAccessibleName(/red king \(yours\), picked up/);
  await expect(square(red, 3, 4)).toHaveAccessibleName(/jump here/);
  await move(red, null, [3, 4]);

  await expect(square(blue, 6, 5)).toHaveAccessibleName(/red king, part of the last move/);
  await expect(blue.page.getByText("8 left")).toBeVisible();
});
