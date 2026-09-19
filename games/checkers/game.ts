import { z } from "zod";

import { nextInt } from "../../shared/prng";
import type { ActionDescription, GameModule, Result } from "../../shared/game";
import type { PlayerId } from "../../shared/protocol";

// Checkers (English draughts) — a sequential game for two players on the 32
// dark squares of an 8×8 board. A man moves one square diagonally forward
// and captures by jumping an adjacent enemy piece; a man that reaches the far
// row is crowned king and may then move and jump backwards too, still one
// square at a time. Capturing is mandatory, and a jump continues for as long
// as the jumping piece can keep jumping. Red always moves first; which
// player gets red is drawn from the seeded PRNG. A player with no legal move
// on their turn (no pieces left, or every piece blocked) loses.

export const SIZE = 8;
export const SQUARES = SIZE * SIZE;

// A turn auto-plays after 24h, the same turn timeout every sequential game
// uses.
export const TURN_TIMEOUT_MS = 24 * 60 * 60 * 1000;

// The 40-move rule: forty moves by each side with no capture and no man
// moving means only kings are shuffling around, and the game is drawn.
export const QUIET_PLY_LIMIT = 80;

export type Side = "red" | "blue";

export interface Piece {
  side: Side;
  king: boolean;
}

export type Square = Piece | null;

// One complete turn. `path` is the moving piece's square followed by every
// square it lands on: one for a step, one per jump for a jump sequence.
// `captured` holds the squares of the jumped pieces, in the order jumped.
export interface Move {
  path: number[];
  captured: number[];
}

export interface CheckersState {
  board: Square[]; // row-major: board[row * SIZE + col], row 0 = blue's back row
  players: Record<Side, PlayerId>;
  turn: Side;
  turnNo: number;
  lastMove: (Move & { side: Side }) | null;
  quietPlies: number; // consecutive moves with no capture and no man moving
  winner: Side | null;
  draw: boolean;
  turnStartedAt: number;
  rng: number;
}

export type MoveAction = { t: "move"; path: number[] };

// A jump sequence captures at most the opponent's twelve pieces, so a path
// is at most thirteen squares long.
export const MoveActionSchema: z.ZodType<MoveAction> = z.object({
  t: z.literal("move"),
  path: z
    .array(
      z
        .number()
        .int()
        .min(0)
        .max(SQUARES - 1),
    )
    .min(2)
    .max(13),
});

// Pieces only ever stand on the dark squares; the light corner is at each
// player's right hand.
export function isDarkSquare(square: number): boolean {
  return (Math.floor(square / SIZE) + (square % SIZE)) % 2 === 1;
}

function other(side: Side): Side {
  return side === "red" ? "blue" : "red";
}

function isOver(state: CheckersState): boolean {
  return state.winner !== null || state.draw;
}

// Red starts on the bottom three rows and moves up the board; blue starts on
// the top three and moves down.
const FORWARD: Record<Side, number> = { red: -1, blue: 1 };
const CROWN_ROW: Record<Side, number> = { red: 0, blue: SIZE - 1 };

function directions(piece: Piece): Array<[dr: number, dc: number]> {
  const rows = piece.king ? [-1, 1] : [FORWARD[piece.side]];
  return rows.flatMap((dr): Array<[number, number]> => [
    [dr, -1],
    [dr, 1],
  ]);
}

// The square `steps` diagonal steps from `square` along (dr, dc), or null if
// that falls off the board.
function offset(square: number, dr: number, dc: number, steps: number): number | null {
  const row = Math.floor(square / SIZE) + dr * steps;
  const col = (square % SIZE) + dc * steps;
  if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return null;
  return row * SIZE + col;
}

function crownsOn(piece: Piece, square: number): boolean {
  return !piece.king && Math.floor(square / SIZE) === CROWN_ROW[piece.side];
}

// Every complete jump sequence for the piece on `from`. No piece can be
// jumped twice in one move, and `from` counts as empty once the piece has
// left it, so a king can loop back to its starting square. A man that lands
// on its crown row is crowned and its move ends there, even if a king could
// jump on.
function jumpsFrom(board: Square[], from: number): Move[] {
  const piece = board[from];
  if (piece === null) return [];

  const moves: Move[] = [];
  const extend = (at: number, path: number[], captured: number[]) => {
    let extended = false;
    for (const [dr, dc] of directions(piece)) {
      const over = offset(at, dr, dc, 1);
      const to = offset(at, dr, dc, 2);
      if (over === null || to === null) continue;
      const jumped = board[over];
      if (jumped === null || jumped.side === piece.side || captured.includes(over)) continue;
      if (board[to] !== null && to !== from) continue;

      extended = true;
      const nextPath = [...path, to];
      const nextCaptured = [...captured, over];
      if (crownsOn(piece, to)) {
        moves.push({ path: nextPath, captured: nextCaptured });
      } else {
        extend(to, nextPath, nextCaptured);
      }
    }
    if (!extended && captured.length > 0) moves.push({ path, captured });
  };
  extend(from, [from], []);
  return moves;
}

function stepsFrom(board: Square[], from: number): Move[] {
  const piece = board[from];
  if (piece === null) return [];

  const moves: Move[] = [];
  for (const [dr, dc] of directions(piece)) {
    const to = offset(from, dr, dc, 1);
    if (to !== null && board[to] === null) moves.push({ path: [from, to], captured: [] });
  }
  return moves;
}

// Every legal move for `side`, grouped by the moving piece's square in
// ascending order. Capturing is mandatory: if any jump exists, only jumps
// are legal. No move's path is a prefix of another's, since a jump sequence
// that can continue must.
export function legalMoves(board: Square[], side: Side): Move[] {
  const own: number[] = [];
  board.forEach((square, i) => {
    if (square?.side === side) own.push(i);
  });
  const jumps = own.flatMap((square) => jumpsFrom(board, square));
  if (jumps.length > 0) return jumps;
  return own.flatMap((square) => stepsFrom(board, square));
}

function initialBoard(): Square[] {
  return Array.from({ length: SQUARES }, (_, i): Square => {
    if (!isDarkSquare(i)) return null;
    const row = Math.floor(i / SIZE);
    if (row < 3) return { side: "blue", king: false };
    if (row >= SIZE - 3) return { side: "red", king: false };
    return null;
  });
}

export function init(players: PlayerId[], seed: number): CheckersState {
  if (players.length !== 2) {
    throw new Error("checkers requires exactly 2 players");
  }
  // Who plays red (and so moves first) comes from the seeded PRNG, never
  // Math.random(); the advanced rng is kept for `onDeadline`'s auto-move.
  const [redIndex, rng] = nextInt(seed, 2);
  return {
    board: initialBoard(),
    players: { red: players[redIndex], blue: players[1 - redIndex] },
    turn: "red",
    turnNo: 0,
    lastMove: null,
    quietPlies: 0,
    winner: null,
    draw: false,
    turnStartedAt: 0,
    rng,
  };
}

function applyMove(state: CheckersState, move: Move, now: number): CheckersState {
  const from = move.path[0];
  const to = move.path[move.path.length - 1];
  const piece = state.board[from] as Piece;

  const board = state.board.slice();
  board[from] = null;
  for (const square of move.captured) board[square] = null;
  board[to] = crownsOn(piece, to) ? { side: piece.side, king: true } : piece;

  const quietPlies = move.captured.length > 0 || !piece.king ? 0 : state.quietPlies + 1;
  const next = other(state.turn);
  // Leaving the opponent without a legal reply wins outright, and takes
  // precedence over the 40-move draw landing on the same move.
  const stuck = legalMoves(board, next).length === 0;

  return {
    ...state,
    board,
    turn: next,
    turnNo: state.turnNo + 1,
    lastMove: { side: state.turn, path: move.path.slice(), captured: move.captured.slice() },
    quietPlies,
    winner: stuck ? state.turn : null,
    draw: !stuck && quietPlies >= QUIET_PLY_LIMIT,
    turnStartedAt: now,
  };
}

function samePath(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((square, i) => square === b[i]);
}

function isPrefix(prefix: number[], path: number[]): boolean {
  return prefix.length < path.length && prefix.every((square, i) => square === path[i]);
}

export function reduce(
  state: CheckersState,
  action: MoveAction,
  by: PlayerId,
  now: number,
): CheckersState {
  if (isOver(state)) {
    throw new Error("match already finished");
  }
  if (by !== state.players[state.turn]) {
    throw new Error("not your turn");
  }

  const moves = legalMoves(state.board, state.turn);
  const move = moves.find((m) => samePath(m.path, action.path));
  if (move) {
    return applyMove(state, move, now);
  }
  // Name the two rules a plausible-looking move most often breaks.
  if (moves.some((m) => isPrefix(action.path, m.path))) {
    throw new Error("keep jumping: a jump must continue while it can");
  }
  if (moves[0]?.captured.length) {
    throw new Error("you must jump when a capture is available");
  }
  throw new Error("that is not a legal move");
}

export function view(state: CheckersState, forPlayer: PlayerId): unknown {
  const you: Side | "spectator" =
    state.players.red === forPlayer
      ? "red"
      : state.players.blue === forPlayer
        ? "blue"
        : "spectator";
  const over = isOver(state);
  const yourTurn = !over && state.players[state.turn] === forPlayer;
  // Nothing in checkers is hidden, so every seat sees the same board. Only
  // the player on turn also gets their legal moves, so the board can offer
  // exactly the moves `reduce` will accept without re-deriving the rules.
  const moves = yourTurn ? legalMoves(state.board, state.turn) : [];
  return {
    board: state.board.slice(),
    players: { ...state.players },
    you,
    turn: over ? null : state.turn,
    yourTurn,
    turnNo: state.turnNo,
    lastMove: state.lastMove && {
      side: state.lastMove.side,
      path: state.lastMove.path.slice(),
      captured: state.lastMove.captured.slice(),
    },
    moves: moves.map((m) => m.path),
    mustJump: moves.some((m) => m.captured.length > 0),
    quietPlies: state.quietPlies,
    winner: state.winner,
    draw: state.draw,
  };
}

export function waitingOn(state: CheckersState): PlayerId[] {
  if (isOver(state)) return [];
  return [state.players[state.turn]];
}

export function deadline(state: CheckersState): number | null {
  if (isOver(state)) return null;
  // `init()` gets no `now`, so `turnStartedAt` stays at its `0` sentinel
  // until the first move stamps a real time. Reporting `0 + TURN_TIMEOUT_MS`
  // (a moment in 1970) would fire the alarm at once and auto-play the
  // opening move before red could react, so the first turn is untimed.
  if (state.turnStartedAt === 0) return null;
  return state.turnStartedAt + TURN_TIMEOUT_MS;
}

export function onDeadline(state: CheckersState, now: number): CheckersState {
  if (isOver(state)) return state;

  // Idempotent, keyed on the turn this deadline was for: every move resets
  // `turnStartedAt` to `now`, pushing the deadline 24h out, so re-running
  // with the same (or an earlier) `now` on either the original state or its
  // own output is a no-op.
  const due = deadline(state);
  if (due === null || now < due) return state;

  const moves = legalMoves(state.board, state.turn);
  if (moves.length === 0) {
    // Unreachable in practice (a move that leaves the opponent without a
    // reply already ends the match), but resolve it rather than leave a live
    // match with no legal move.
    return { ...state, winner: other(state.turn) };
  }

  const [pick, rng] = nextInt(state.rng, moves.length);
  return applyMove({ ...state, rng }, moves[pick], now);
}

export function result(state: CheckersState): Result | null {
  if (state.winner !== null) return { kind: "win", winners: [state.players[state.winner]] };
  if (state.draw) return { kind: "draw" };
  return null;
}

// Algebraic notation for one square: file letter, then rank counted from
// blue's back row. The board is *drawn* flipped for blue, so a row index
// would name a different square for each player — a name fixed to the board
// itself is the only one both players read the same way.
export function squareName(square: number): string {
  const row = Math.floor(square / SIZE);
  const col = square % SIZE;
  return `${String.fromCharCode("a".charCodeAt(0) + col)}${row + 1}`;
}

// The action carries only the squares the piece lands on, so the number of
// pieces taken comes from matching it against the legal moves — the same
// lookup `reduce` does. An unmatched path is still described (the engine
// only ever logs an action `reduce` has already accepted, but a description
// must never be the thing that throws).
export function describeAction(state: CheckersState, action: MoveAction): ActionDescription {
  const from = action.path[0];
  const to = action.path[action.path.length - 1];
  const move = legalMoves(state.board, state.turn).find((m) => samePath(m.path, action.path));
  const captured = move?.captured.length ?? 0;
  const values = { from: squareName(from), to: squareName(to) };
  return captured > 0
    ? { key: "history.jump", values: { ...values, count: captured } }
    : { key: "history.move", values };
}

export const checkersGame: GameModule<CheckersState, MoveAction> = {
  id: "checkers",
  meta: { name: "Checkers", minPlayers: 2, maxPlayers: 2 },
  actionSchema: MoveActionSchema,
  init,
  reduce,
  view,
  waitingOn,
  deadline,
  onDeadline,
  result,
  describeAction,
};
