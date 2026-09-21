import type { ComponentType } from "react";

import G2048Icon from "./2048/icon";
import BattleshipIcon from "./battleship/icon";
import CheckersIcon from "./checkers/icon";
import Connect4Icon from "./connect4/icon";
import MinesweeperIcon from "./minesweeper/icon";
import SudokuIcon from "./sudoku/icon";
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
  "2048": G2048Icon,
  battleship: BattleshipIcon,
  checkers: CheckersIcon,
  connect4: Connect4Icon,
  minesweeper: MinesweeperIcon,
  sudoku: SudokuIcon,
  tictactoe: TicTacToeIcon,
  trivia: TriviaIcon,
};
