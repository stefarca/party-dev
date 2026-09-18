import type { ComponentType } from "react";

import Connect4Icon from "./connect4/icon";
import TicTacToeIcon from "./tictactoe/icon";
import TriviaIcon from "./trivia/icon";

// id -> the icon on the game's tile: the contents of a 24×24 `<svg>`, drawn in `currentColor`
// over the game's gradient (see `web/components/GameGlyph.tsx`). Optional — a game left out of
// this map gets an abstract motif picked by hashing its id.
//
// Client-only, and deliberately not in `games/registry.ts`: the Worker imports that file, and
// these are `.tsx` modules. Statically imported rather than lazy like `gameUi`, because the
// dashboard shows every game's tile at once and each icon is a few SVG paths.
export const gameIcons: Record<string, ComponentType> = {
  connect4: Connect4Icon,
  tictactoe: TicTacToeIcon,
  trivia: TriviaIcon,
};
