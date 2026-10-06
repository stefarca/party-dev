import { expect, test } from "./fixtures";
import type { Player } from "./fixtures";

// A finished match leads straight to the next one. Tic-tac-toe is just the quickest game to
// finish; the rematch is the same for every game.

function square(player: Player, row: number, col: number) {
  return player.page.getByRole("button", { name: new RegExp(`^Row ${row}, column ${col},`) });
}

// x takes the top row while o plays the middle one.
async function finish(x: Player, o: Player) {
  const moves: [Player, number, number][] = [
    [x, 1, 1],
    [o, 2, 1],
    [x, 1, 2],
    [o, 2, 2],
    [x, 1, 3],
  ];
  for (const [player, row, col] of moves) {
    await expect(player.yourTurn).toBeVisible();
    await square(player, row, col).click();
  }
}

test("the loser asks for a rematch, and the winner joins it from the finished match", async ({
  startMatch,
}) => {
  const {
    code,
    players: [x, o],
  } = await startMatch("tictactoe");
  await finish(x, o);

  await o.page.getByRole("button", { name: "Rematch", exact: true }).click();
  await expect(o.page).not.toHaveURL(new RegExp(`/m/${code}$`));
  const rematch = new URL(o.page.url()).pathname;

  // x is still looking at the finished match, and the offer reaches it there.
  await expect(x.page.getByText(`${o.nickname} wants a rematch!`)).toBeVisible();
  await x.page.getByRole("button", { name: "Join the rematch" }).click();
  await expect(x.page).toHaveURL(new RegExp(`${rematch}$`));

  // Two seats, two players: joining started it, and somebody has the first move.
  await expect(x.live).toBeVisible();
  await expect(x.yourTurn.or(x.waitingOn(o))).toBeVisible();
  await expect(o.yourTurn.or(o.waitingOn(x))).toBeVisible();
});

test("asking again finds the rematch already opened", async ({ startMatch }) => {
  const {
    players: [x, o],
  } = await startMatch("tictactoe");
  await finish(x, o);

  await x.page.getByRole("button", { name: "Rematch", exact: true }).click();
  await expect(x.page.getByRole("heading", { name: "Invite your crew" })).toBeVisible();
  const rematch = new URL(x.page.url()).pathname;

  await x.page.goBack();
  await x.page.getByRole("button", { name: "Go to the rematch" }).click();
  await expect(x.page).toHaveURL(new RegExp(`${rematch}$`));
});
