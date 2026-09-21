import { expect, test } from "vitest";

import { dailyGames, dailyUi, gameUi, serverGames } from "./registry";

// A game's id names its folder, and so its i18n namespace and its tile icon: one id can only
// ever be one game, whichever half of the registry it is in.
test("no id is both a match game and a daily game", () => {
  const shared = Object.keys(dailyGames).filter((id) => id in serverGames);
  expect(shared).toEqual([]);
});

test("every game is registered on both sides, under its own id", () => {
  expect(Object.keys(gameUi).sort()).toEqual(Object.keys(serverGames).sort());
  expect(Object.keys(dailyUi).sort()).toEqual(Object.keys(dailyGames).sort());
  for (const [id, game] of [...Object.entries(serverGames), ...Object.entries(dailyGames)]) {
    expect(game.id).toBe(id);
  }
});
