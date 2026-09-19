import { z } from "zod";

import { nextInt } from "../../shared/prng";
import type { ActionDescription, GameModule, Result } from "../../shared/game";
import type { PlayerId } from "../../shared/protocol";

// Connect 4 — the first real game, proving the "sequential" phase type end
// to end. Two players drop discs into a 7-wide,
// 6-tall board, alternating turns, until one connects four in a row or the
// board fills.

export const ROWS = 6;
export const COLS = 7;

// A turn auto-passes after 24h — the binding turn timeout for every
// sequential game.
export const TURN_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export type Cell = 0 | 1 | null;

export interface LastMove {
  col: number;
  row: number;
}

export interface C4State {
  board: Cell[][]; // board[row][col], row 0 = bottom
  players: [PlayerId, PlayerId];
  turn: 0 | 1;
  turnNo: number;
  lastMove: LastMove | null;
  winner: 0 | 1 | null;
  draw: boolean;
  startedAt: number;
  turnStartedAt: number;
  rng: number;
}

export type DropAction = { t: "drop"; col: number };

export const DropActionSchema: z.ZodType<DropAction> = z.object({
  t: z.literal("drop"),
  col: z
    .number()
    .int()
    .min(0)
    .max(COLS - 1),
});

function emptyBoard(): Cell[][] {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null as Cell));
}

// The lowest empty row in `col`, or null if the column is full.
function lowestEmptyRow(board: Cell[][], col: number): number | null {
  for (let row = 0; row < ROWS; row++) {
    if (board[row][col] === null) return row;
  }
  return null;
}

const DIRECTIONS: Array<[dr: number, dc: number]> = [
  [0, 1], // horizontal
  [1, 0], // vertical
  [1, 1], // diagonal /
  [1, -1], // diagonal \
];

// Checks for a four-in-a-row through the just-placed disc only (10 ms CPU budget: a
// full-board scan is unnecessary work on every move; the four directions
// through the last move are sufficient and cheap).
function isWinningMove(board: Cell[][], row: number, col: number): boolean {
  const player = board[row][col];
  if (player === null) return false;

  for (const [dr, dc] of DIRECTIONS) {
    let count = 1;
    for (const sign of [1, -1] as const) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === player) {
        count++;
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (count >= 4) return true;
  }
  return false;
}

function isBoardFull(board: Cell[][]): boolean {
  return board[ROWS - 1].every((cell) => cell !== null);
}

// The columns that can still accept a disc, in ascending order — shared by
// `reduce`'s legality check and `onDeadline`'s auto-move choice.
function openColumns(board: Cell[][]): number[] {
  const cols: number[] = [];
  for (let col = 0; col < COLS; col++) {
    if (lowestEmptyRow(board, col) !== null) cols.push(col);
  }
  return cols;
}

export function init(players: PlayerId[], seed: number): C4State {
  if (players.length !== 2) {
    throw new Error("connect4 requires exactly 2 players");
  }
  const pair: [PlayerId, PlayerId] = [players[0], players[1]];
  // Seeded PRNG rule: even "who goes first" must go through the seeded PRNG, never
  // Math.random(), and the advanced rng state is stored so later phases
  // (onDeadline's auto-move) can keep drawing from it deterministically.
  const [firstIndex, rng] = nextInt(seed, 2);
  return {
    board: emptyBoard(),
    players: pair,
    turn: firstIndex as 0 | 1,
    turnNo: 0,
    lastMove: null,
    winner: null,
    draw: false,
    startedAt: 0,
    turnStartedAt: 0,
    rng,
  };
}

function placeDisc(state: C4State, col: number, now: number): C4State {
  const row = lowestEmptyRow(state.board, col);
  if (row === null) {
    throw new Error("that column is full");
  }

  const board = state.board.map((r) => r.slice());
  board[row][col] = state.turn;

  const won = isWinningMove(board, row, col);
  const draw = !won && isBoardFull(board);

  return {
    ...state,
    board,
    turn: state.turn === 0 ? 1 : 0,
    turnNo: state.turnNo + 1,
    lastMove: { col, row },
    winner: won ? state.turn : null,
    draw,
    turnStartedAt: now,
  };
}

export function reduce(state: C4State, action: DropAction, by: PlayerId, now: number): C4State {
  if (state.winner !== null || state.draw) {
    throw new Error("match already finished");
  }
  if (by !== state.players[state.turn]) {
    throw new Error("not your turn");
  }
  return placeDisc(state, action.col, now);
}

export function view(state: C4State, forPlayer: PlayerId): unknown {
  const seat = state.players.indexOf(forPlayer);
  return {
    board: state.board.map((row) => row.slice()),
    you: seat === 0 || seat === 1 ? (seat as 0 | 1) : "spectator",
    yourTurn: state.winner === null && !state.draw && state.players[state.turn] === forPlayer,
    turnNo: state.turnNo,
    lastMove: state.lastMove,
    winner: state.winner,
    draw: state.draw,
    deadline: deadline(state),
  };
}

export function waitingOn(state: C4State): PlayerId[] {
  if (state.winner !== null || state.draw) return [];
  return [state.players[state.turn]];
}

export function deadline(state: C4State): number | null {
  if (state.winner !== null || state.draw) return null;
  // `init()` has no `now` (the `GameModule` signature is `init(players, seed)`),
  // so it cannot stamp a real wall-clock start for the very first turn —
  // `turnStartedAt` is left at its `0` sentinel until the first `reduce()`
  // call (which does get a real `now`) sets it for real. Treat `0` as "not
  // timed yet" rather than a real epoch millisecond: a real `turnStartedAt`
  // is always a large, current epoch value, and reporting a deadline of
  // `0 + TURN_TIMEOUT_MS` (a moment in 1970) would tell the DO to fire its
  // alarm immediately, auto-playing the very first turn before either
  // player could react.
  if (state.turnStartedAt === 0) return null;
  return state.turnStartedAt + TURN_TIMEOUT_MS;
}

export function onDeadline(state: C4State, now: number): C4State {
  if (state.winner !== null || state.draw) return state;

  // Idempotent, keyed on the turn this deadline was for:
  // `deadline()` is `turnStartedAt + TURN_TIMEOUT_MS`, and placing a disc
  // (below) always resets `turnStartedAt` to `now`, pushing the deadline
  // 24h further out. So re-running `onDeadline` with the same (or an
  // earlier) `now` on either the original state or its own output is a
  // guaranteed no-op: the turn the alarm was for has already resolved and
  // the new deadline has not been reached yet.
  const due = deadline(state);
  if (due === null || now < due) return state;

  const cols = openColumns(state.board);
  if (cols.length === 0) {
    // No legal move exists (board full without a line) — the deadline
    // firing here just means the draw was not yet observed; resolve it.
    return { ...state, draw: true };
  }

  const [pick, rng] = nextInt(state.rng, cols.length);
  const col = cols[pick];
  return placeDisc({ ...state, rng }, col, now);
}

export function result(state: C4State): Result | null {
  if (state.winner !== null) return { kind: "win", winners: [state.players[state.winner]] };
  if (state.draw) return { kind: "draw" };
  return null;
}

// Columns are 0-indexed in the action and 1-indexed everywhere a player
// reads one, so the history says "column 4" for the fourth column, matching
// the board's own labels.
export function describeAction(_state: C4State, action: DropAction): ActionDescription {
  return { key: "history.drop", values: { column: action.col + 1 } };
}

export const connect4Game: GameModule<C4State, DropAction> = {
  id: "connect4",
  meta: { name: "Connect 4", minPlayers: 2, maxPlayers: 2 },
  actionSchema: DropActionSchema,
  init,
  reduce,
  view,
  waitingOn,
  deadline,
  onDeadline,
  result,
  describeAction,
};
