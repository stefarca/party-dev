import { z } from "zod";

import { nextInt } from "../../shared/prng";
import type { DailyGameModule, DailyScore } from "../../shared/game";

// 2048, as a daily game. Slide every tile on a 4×4 board one way; two equal
// tiles that meet merge into their sum, which is added to the score; then a
// new 2 (or, one time in ten, a 4) appears on a random empty cell. The run
// ends when no slide changes the board. The chart ranks runs by score.
//
// Every player starts from the day's seed, so they all get the same opening
// board and the same stream of random draws. Where each new tile lands still
// depends on the board a player has made, so the boards drift apart from the
// first move.
//
// Reaching the 2048 tile is not the end: the run goes on, and so does the
// score, for as long as the board has a move left.

export const SIZE = 4;
export const CELLS = SIZE * SIZE;
export const GOAL = 2048;

// One tile in ten spawns as a 4, the rest as a 2.
const FOUR_ODDS = 10;

export type Direction = "up" | "down" | "left" | "right";

export const DIRECTIONS: readonly Direction[] = ["up", "down", "left", "right"];

// A tile keeps its id from the moment it spawns until another tile merges
// into it, so the board can slide each one from where it was to where it is.
export interface Tile {
  id: number;
  value: number;
}

// Row-major: cell = row * SIZE + col, row 0 at the top.
export type Board = (Tile | null)[];

// What the last move did, for the board to animate. Nothing here affects the
// rules.
export interface MoveTrace {
  // Tiles that another tile merged into this move. Each keeps its id.
  merged: number[];
  // The tiles that merged away, and the cell they slid into as they did.
  absorbed: { id: number; value: number; cell: number }[];
  // The tile the move spawned.
  spawned: number | null;
}

export interface G2048State {
  board: Board;
  score: number;
  moves: number;
  // No slide changes the board any more.
  over: boolean;
  nextId: number;
  // The PRNG state. Never leaves the server: with it, a player could see
  // every tile the day has left to spawn.
  rng: number;
  last: MoveTrace | null;
}

export type G2048Action = { t: "move"; dir: Direction };

export const G2048ActionSchema: z.ZodType<G2048Action> = z.object({
  t: z.literal("move"),
  dir: z.enum(["up", "down", "left", "right"]),
});

// The board's four lines along `dir`, each listed from the edge the tiles
// slide towards.
function linesToward(dir: Direction): number[][] {
  const lines: number[][] = [];
  for (let i = 0; i < SIZE; i++) {
    const line: number[] = [];
    for (let j = 0; j < SIZE; j++) {
      line.push(dir === "left" || dir === "right" ? i * SIZE + j : j * SIZE + i);
    }
    lines.push(dir === "right" || dir === "down" ? line.reverse() : line);
  }
  return lines;
}

export interface Slide {
  board: Board;
  gained: number;
  moved: boolean;
  merged: number[];
  absorbed: MoveTrace["absorbed"];
}

// Slides every tile on `board` towards `dir`. Tiles are merged from the edge
// they slide to, and a tile made by a merge does not merge again in the same
// slide, so 2 2 2 2 becomes 4 4, never 8. The tile nearer that edge is the one
// that stays; the other is absorbed into it. Does not spawn.
export function slide(board: Board, dir: Direction): Slide {
  const next: Board = Array.from({ length: CELLS }, () => null);
  const merged: number[] = [];
  const absorbed: MoveTrace["absorbed"] = [];
  let gained = 0;

  for (const line of linesToward(dir)) {
    let filled = 0;
    // Whether the tile last placed on this line can still take a merge.
    let open = false;
    for (const cell of line) {
      const tile = board[cell];
      if (!tile) continue;
      const lastCell = line[filled - 1];
      const last = filled > 0 ? next[lastCell] : null;
      if (open && last && last.value === tile.value) {
        next[lastCell] = { id: last.id, value: last.value * 2 };
        gained += last.value * 2;
        merged.push(last.id);
        absorbed.push({ id: tile.id, value: tile.value, cell: lastCell });
        open = false;
      } else {
        next[line[filled]] = tile;
        filled++;
        open = true;
      }
    }
  }

  const moved = merged.length > 0 || next.some((tile, cell) => tile?.id !== board[cell]?.id);
  return { board: next, gained, moved, merged, absorbed };
}

// Whether any slide would change `board`.
export function hasMove(board: Board): boolean {
  for (let cell = 0; cell < CELLS; cell++) {
    const tile = board[cell];
    if (!tile) return true;
    const col = cell % SIZE;
    if (col < SIZE - 1 && board[cell + 1]?.value === tile.value) return true;
    if (cell + SIZE < CELLS && board[cell + SIZE]?.value === tile.value) return true;
  }
  return false;
}

export function bestTile(board: Board): number {
  return board.reduce((best, tile) => Math.max(best, tile?.value ?? 0), 0);
}

// Puts a new tile on a random empty cell of `board`, drawn from `rng`: first
// the cell, then its value. A full board is returned as it is.
function spawn(
  board: Board,
  rng: number,
  id: number,
): { board: Board; rng: number; spawned: number | null } {
  const empty = board.flatMap((tile, cell) => (tile ? [] : [cell]));
  if (empty.length === 0) return { board, rng, spawned: null };
  const [pick, afterCell] = nextInt(rng, empty.length);
  const [roll, afterValue] = nextInt(afterCell, FOUR_ODDS);
  const next = board.slice();
  next[empty[pick]] = { id, value: roll === 0 ? 4 : 2 };
  return { board: next, rng: afterValue, spawned: id };
}

export function init(seed: number): G2048State {
  const empty: Board = Array.from({ length: CELLS }, () => null);
  const first = spawn(empty, seed, 1);
  const second = spawn(first.board, first.rng, 2);
  return {
    board: second.board,
    score: 0,
    moves: 0,
    over: false,
    nextId: 3,
    rng: second.rng,
    last: null,
  };
}

// A slide that changes nothing is not a move — nothing spawns and nothing is
// counted — but it is not an error either, the same as pressing into a wall
// on any 2048 board. That also lets a player queue moves faster than the
// board can confirm them without one that turns out to be blocked failing
// the rest.
export function reduce(state: G2048State, action: G2048Action): G2048State {
  if (state.over) throw new Error("the board has no moves left");
  const slid = slide(state.board, action.dir);
  if (!slid.moved) return state;
  const spawned = spawn(slid.board, state.rng, state.nextId);
  return {
    board: spawned.board,
    score: state.score + slid.gained,
    moves: state.moves + 1,
    over: !hasMove(spawned.board),
    nextId: state.nextId + 1,
    rng: spawned.rng,
    last: { merged: slid.merged, absorbed: slid.absorbed, spawned: spawned.spawned },
  };
}

export interface G2048View {
  size: number;
  tiles: { id: number; value: number; cell: number }[];
  score: number;
  moves: number;
  best: number;
  over: boolean;
  last: MoveTrace | null;
}

// Everything but the PRNG state and the next tile id.
export function view(state: G2048State): G2048View {
  const tiles = state.board
    .flatMap((tile, cell) => (tile ? [{ id: tile.id, value: tile.value, cell }] : []))
    .sort((a, b) => a.id - b.id);
  return {
    size: SIZE,
    tiles,
    score: state.score,
    moves: state.moves,
    best: bestTile(state.board),
    over: state.over,
    last: state.last,
  };
}

// The board a view shows, rebuilt so the UI can run `slide` against it.
export function boardOf(tiles: G2048View["tiles"]): Board {
  const board: Board = Array.from({ length: CELLS }, () => null);
  for (const { id, value, cell } of tiles) board[cell] = { id, value };
  return board;
}

export function score(state: G2048State): DailyScore {
  return {
    value: state.score,
    detail: {
      key: "chart.detail",
      values: { tile: bestTile(state.board), count: state.moves },
    },
  };
}

export const g2048Game: DailyGameModule<G2048State, G2048Action> = {
  id: "2048",
  meta: { name: "2048", order: "desc", format: "number" },
  actionSchema: G2048ActionSchema,
  init,
  reduce,
  view,
  finished: (state) => state.over,
  score,
};
