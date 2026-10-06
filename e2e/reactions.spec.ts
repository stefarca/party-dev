import { expect, test } from "./fixtures";
import type { Player } from "./fixtures";

// Reactions: a fixed set of emoji any player can send during or after a match, seen at once by
// everyone watching and kept in the history for anyone who was not.

async function openHistory(player: Player) {
  await player.page.getByRole("button", { name: /^History/ }).click();
  return player.page.getByRole("list", { name: "History" }).getByRole("listitem");
}

test("a reaction reaches the other player live, and stays in the history", async ({
  startMatch,
}) => {
  const {
    players: [x, o],
  } = await startMatch("tictactoe");

  await o.page.getByRole("button", { name: "React with Hurry up" }).click();

  const live = x.page.getByRole("log", { name: "Live reactions" });
  await expect(live.getByText(`${o.nickname} reacted with Hurry up`)).toBeVisible();

  // The buttons wait out the server's cooldown rather than offer a reaction it would refuse.
  await expect(o.page.getByRole("button", { name: "React with Laugh" })).toBeDisabled();
  await expect(o.page.getByRole("button", { name: "React with Laugh" })).toBeEnabled();

  // A page that loads afterwards finds it in the history, from the snapshot.
  await x.page.reload();
  await expect(x.live).toBeVisible();
  const rows = await openHistory(x);
  await expect(rows.filter({ hasText: `${o.nickname} reacted 🐢` })).toBeVisible();
});
