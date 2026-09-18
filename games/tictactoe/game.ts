import { z } from "zod";

import { nextInt } from "../../shared/prng";
import type { GameModule, Result } from "../../shared/game";
import type { PlayerId } from "../../shared/protocol";

// Tic-tac-toe — a sequential game for two players on a 3×3 grid. X always
// moves first; which player gets X is drawn from the seeded PRNG. The first
// player to fill a row, column or diagonal with their mark wins, and a full
// board without a line is a draw.

export const SIZE = 3;
export const CELLS = SIZE * SIZE;

// A turn auto-plays after 24h, the same turn timeout every sequential game
// uses.
export const TURN_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export type Mark = "X" | "O";
export type Cell = Mark | null;

export interface TttState {
  board: Cell[]; // row-major: board[row * SIZE + col]
  players: Record<Mark, PlayerId>;
  turn: Mark;
  turnNo: number;
  lastMove: number | null; // cell index
  winner: Mark | null;
  winLine: number[] | null; // the three cell indexes of the winning line
  draw: boolean;
  turnStartedAt: number;
  rng: number;
}

export type PlaceAction = { t: "place"; cell: number };

export const PlaceActionSchema: z.ZodType<PlaceAction> = z.object({
  t: z.literal("place"),
  cell: z
    .number()
    .int()
    .min(0)
    .max(CELLS - 1),
});

// Every line that wins: three rows, three columns, two diagonals.
const LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function other(mark: Mark): Mark {
  return mark === "X" ? "O" : "X";
}

function isOver(state: TttState): boolean {
  return state.winner !== null || state.draw;
}

// Only a line through the cell just played can have been completed by it.
function winLineThrough(board: Cell[], cell: number): number[] | null {
  const mark = board[cell];
  if (mark === null) return null;
  const line = LINES.find((l) => l.includes(cell) && l.every((i) => board[i] === mark));
  return line ? [...line] : null;
}

// The empty cells in ascending order, used by `onDeadline`'s auto-move.
function emptyCells(board: Cell[]): number[] {
  const cells: number[] = [];
  board.forEach((cell, i) => {
    if (cell === null) cells.push(i);
  });
  return cells;
}

export function init(players: PlayerId[], seed: number): TttState {
  if (players.length !== 2) {
    throw new Error("tic-tac-toe requires exactly 2 players");
  }
  // Who plays X (and so moves first) comes from the seeded PRNG, never
  // Math.random(); the advanced rng is kept for `onDeadline`'s auto-move.
  const [xIndex, rng] = nextInt(seed, 2);
  return {
    board: Array.from({ length: CELLS }, () => null as Cell),
    players: { X: players[xIndex], O: players[1 - xIndex] },
    turn: "X",
    turnNo: 0,
    lastMove: null,
    winner: null,
    winLine: null,
    draw: false,
    turnStartedAt: 0,
    rng,
  };
}

function placeMark(state: TttState, cell: number, now: number): TttState {
  if (state.board[cell] !== null) {
    throw new Error("that square is taken");
  }

  const board = state.board.slice();
  board[cell] = state.turn;

  const winLine = winLineThrough(board, cell);
  const draw = winLine === null && board.every((c) => c !== null);

  return {
    ...state,
    board,
    turn: other(state.turn),
    turnNo: state.turnNo + 1,
    lastMove: cell,
    winner: winLine ? state.turn : null,
    winLine,
    draw,
    turnStartedAt: now,
  };
}

export function reduce(state: TttState, action: PlaceAction, by: PlayerId, now: number): TttState {
  if (isOver(state)) {
    throw new Error("match already finished");
  }
  if (by !== state.players[state.turn]) {
    throw new Error("not your turn");
  }
  return placeMark(state, action.cell, now);
}

export function view(state: TttState, forPlayer: PlayerId): unknown {
  const you: Mark | "spectator" =
    state.players.X === forPlayer ? "X" : state.players.O === forPlayer ? "O" : "spectator";
  const over = isOver(state);
  // Nothing in tic-tac-toe is hidden, so every seat sees the same board;
  // only `you`/`yourTurn` differ per player.
  return {
    board: state.board.slice(),
    players: { ...state.players },
    you,
    turn: over ? null : state.turn,
    yourTurn: !over && state.players[state.turn] === forPlayer,
    turnNo: state.turnNo,
    lastMove: state.lastMove,
    winner: state.winner,
    winLine: state.winLine ? state.winLine.slice() : null,
    draw: state.draw,
  };
}

export function waitingOn(state: TttState): PlayerId[] {
  if (isOver(state)) return [];
  return [state.players[state.turn]];
}

export function deadline(state: TttState): number | null {
  if (isOver(state)) return null;
  // `init()` gets no `now`, so `turnStartedAt` stays at its `0` sentinel
  // until the first move stamps a real time. Reporting `0 + TURN_TIMEOUT_MS`
  // (a moment in 1970) would fire the alarm at once and auto-play the
  // opening move before X could react, so the first turn is untimed.
  if (state.turnStartedAt === 0) return null;
  return state.turnStartedAt + TURN_TIMEOUT_MS;
}

export function onDeadline(state: TttState, now: number): TttState {
  if (isOver(state)) return state;

  // Idempotent, keyed on the turn this deadline was for: placing a mark
  // always resets `turnStartedAt` to `now`, pushing the deadline 24h out, so
  // re-running with the same (or an earlier) `now` on either the original
  // state or its own output is a no-op.
  const due = deadline(state);
  if (due === null || now < due) return state;

  const cells = emptyCells(state.board);
  if (cells.length === 0) {
    // Unreachable in practice (a full board is already a draw or a win),
    // but resolve it rather than leave a live match with no legal move.
    return { ...state, draw: true };
  }

  const [pick, rng] = nextInt(state.rng, cells.length);
  return placeMark({ ...state, rng }, cells[pick], now);
}

export function result(state: TttState): Result | null {
  if (state.winner !== null) return { kind: "win", winners: [state.players[state.winner]] };
  if (state.draw) return { kind: "draw" };
  return null;
}

export const tictactoeGame: GameModule<TttState, PlaceAction> = {
  id: "tictactoe",
  meta: { name: "Tic-tac-toe", minPlayers: 2, maxPlayers: 2 },
  actionSchema: PlaceActionSchema,
  init,
  reduce,
  view,
  waitingOn,
  deadline,
  onDeadline,
  result,
};
