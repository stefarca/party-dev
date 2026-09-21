import type { ComponentType } from "react";

import { g2048Game } from "./2048/game";
import { battleshipGame } from "./battleship/game";
import { checkersGame } from "./checkers/game";
import { connect4Game } from "./connect4/game";
import { sudokuGame } from "./sudoku/game";
import { tictactoeGame } from "./tictactoe/game";
import { triviaGame } from "./trivia/game";
import type { DailyGameModule, GameModule } from "../shared/game";
import type { DailyUiProps, GameUiProps } from "../shared/protocol";

// id -> module (server, statically imported) and id -> lazy import
// (client). This is the entire integration surface for a new game —
// registering one is meant to be a one-line change to each map below,
// nothing else. (A game's tile icon is optional and registered separately, in
// the client-only `gameIcons` map in games/icons.ts.)
//
// `serverGames` is statically imported so the Worker bundle contains every
// game's rules (the DO must be able to run any match without a network
// round-trip). It must never import a `.tsx` file — that would pull React
// into the Worker bundle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- registry is intentionally generic over each game's state/action types
export const serverGames: Record<string, GameModule<any, any>> = {
  battleship: battleshipGame,
  checkers: checkersGame,
  connect4: connect4Game,
  tictactoe: tictactoeGame,
  trivia: triviaGame,
};

// `gameUi` is dynamically imported so the client bundle does not grow
// linearly with the number of games — only the UI for the game you are
// actually looking at is ever fetched.
export const gameUi: Record<string, () => Promise<{ default: ComponentType<GameUiProps> }>> = {
  battleship: () => import("./battleship/ui"),
  checkers: () => import("./checkers/ui"),
  connect4: () => import("./connect4/ui"),
  tictactoe: () => import("./tictactoe/ui"),
  trivia: () => import("./trivia/ui"),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- lookup is intentionally generic over each game's state/action types
export function getGame(id: string): GameModule<any, any> | undefined {
  return serverGames[id];
}

// The daily single-player games, registered the same way in two maps of
// their own: `dailyGames` for the Worker (run by `DailyDO`, never by
// `MatchDO`) and `dailyUi` for the client. Kept apart from the two maps
// above so a daily game can never be started as a match, nor a match game
// as a daily run. An id must not appear in both halves of the registry: a
// game's folder, and so its i18n namespace, is named by it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- registry is intentionally generic over each game's state/action types
export const dailyGames: Record<string, DailyGameModule<any, any>> = {
  "2048": g2048Game,
  sudoku: sudokuGame,
};

export const dailyUi: Record<string, () => Promise<{ default: ComponentType<DailyUiProps> }>> = {
  "2048": () => import("./2048/ui"),
  sudoku: () => import("./sudoku/ui"),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- lookup is intentionally generic over each game's state/action types
export function getDailyGame(id: string): DailyGameModule<any, any> | undefined {
  return Object.hasOwn(dailyGames, id) ? dailyGames[id] : undefined;
}
