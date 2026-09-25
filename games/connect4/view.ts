// What `view()` sends one player: the board as they may see it.

export type Cell = 0 | 1 | null;

export interface Connect4View {
  board: Cell[][]; // board[row][col], row 0 = bottom
  you: 0 | 1 | "spectator";
  yourTurn: boolean;
  turnNo: number;
  lastMove: { col: number; row: number } | null;
  winner: 0 | 1 | null;
  draw: boolean;
  deadline: number | null;
}
