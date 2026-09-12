import type { ComponentType } from "react";

import { connect4Game } from "./connect4/game";
import { triviaGame } from "./trivia/game";
import type { GameModule } from "../shared/game";
import type { GameUiProps } from "../shared/protocol";

// PLAN.md §9: id -> module (server, statically imported) and id -> lazy
// import (client). This is the entire integration surface for a new game
// (§12 step 7) — registering one is meant to be a one-line change to each
// map below, nothing else.
//
// `serverGames` is statically imported so the Worker bundle contains every
// game's rules (the DO must be able to run any match without a network
// round-trip). It must never import a `.tsx` file — that would pull React
// into the Worker bundle.
export const serverGames: Record<string, GameModule<any, any>> = {
  connect4: connect4Game,
  trivia: triviaGame,
};

// `gameUi` is dynamically imported so the client bundle does not grow
// linearly with the number of games (§9) — only the UI for the game you are
// actually looking at is ever fetched.
export const gameUi: Record<string, () => Promise<{ default: ComponentType<GameUiProps> }>> = {
  connect4: () => import("./connect4/ui"),
  trivia: () => import("./trivia/ui"),
};

export function getGame(id: string): GameModule<any, any> | undefined {
  return serverGames[id];
}
