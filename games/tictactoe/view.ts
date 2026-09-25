import type { Cell, Mark } from "./game";

// What `view()` sends one player: the board as they may see it.
export interface TicTacToeView {
  board: Cell[]; // row-major: board[row * SIZE + col]
  players: Record<Mark, string>;
  you: Mark | "spectator";
  turn: Mark | null;
  yourTurn: boolean;
  turnNo: number;
  lastMove: number | null;
  winner: Mark | null;
  winLine: number[] | null;
  draw: boolean;
}
