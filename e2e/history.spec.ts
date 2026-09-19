import { expect, test } from "./fixtures";
import type { Player } from "./fixtures";

// The match history: what it says, and that it is still there after a reload. Tic-tac-toe is
// the simplest game to drive; the panel itself is generic, and every game's wording comes from
// its own `describeAction`.

function square(player: Player, row: number, col: number) {
  return player.page.getByRole("button", { name: new RegExp(`^Row ${row}, column ${col},`) });
}

// The panel is collapsed until someone opens it. Returns its rows.
async function openHistory(player: Player) {
  await player.page.getByRole("button", { name: /^History/ }).click();
  return player.page.getByRole("list", { name: "History" }).getByRole("listitem");
}

test("the history reads as sentences, not payloads", async ({ startMatch }) => {
  const {
    players: [x, o],
  } = await startMatch("tictactoe");

  await square(x, 2, 2).click();
  await expect(o.yourTurn).toBeVisible();

  const rows = await openHistory(o);
  await expect(rows.filter({ hasText: `${x.nickname} placed X on row 2, column 2` })).toBeVisible();
  await expect(rows.filter({ hasText: `${x.nickname} joined` })).toBeVisible();
  await expect(rows.filter({ hasText: "The match started" })).toBeVisible();
  // Nothing in the panel is raw JSON any more.
  await expect(rows.filter({ hasText: /[{}]/ })).toHaveCount(0);
});

test("the history survives a reload", async ({ startMatch }) => {
  const {
    players: [x, o],
  } = await startMatch("tictactoe");

  await square(x, 2, 2).click();
  await expect(o.yourTurn).toBeVisible();
  await square(o, 1, 1).click();
  await expect(x.yourTurn).toBeVisible();

  // A reload starts with no history at all and a `since` already at the latest event, so this
  // is only true because the page fetches the log over HTTP rather than waiting for the socket
  // to push something new.
  await x.page.reload();
  await expect(x.live).toBeVisible();

  const rows = await openHistory(x);
  await expect(rows.filter({ hasText: `${x.nickname} placed X on row 2, column 2` })).toBeVisible();
  await expect(rows.filter({ hasText: `${o.nickname} placed O on row 1, column 1` })).toBeVisible();
});
