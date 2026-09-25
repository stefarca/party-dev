import type { Side, Square } from "./game";

// What `view()` sends one player: the board as they may see it.
export interface CheckersView {
  board: Square[]; // row-major: board[row * SIZE + col], row 0 = blue's back row
  players: Record<Side, string>;
  you: Side | "spectator";
  turn: Side | null;
  yourTurn: boolean;
  turnNo: number;
  lastMove: { side: Side; path: number[]; captured: number[] } | null;
  moves: number[][]; // your legal moves as square paths, sent only while it is your turn
  mustJump: boolean;
  quietPlies: number;
  winner: Side | null;
  draw: boolean;
}
