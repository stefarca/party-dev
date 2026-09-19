import { z } from "zod";

import { nextInt } from "../../shared/prng";
import type { ActionDescription, GameModule, Result } from "../../shared/game";
import type { PlayerId } from "../../shared/protocol";

// Battleship — two players, each with a hidden fleet on a 10×10 grid of their
// own. The match has two phases:
//
// - Placing (simultaneous): both players lay out their whole fleet at once,
//   in any order, each in a single action. Ships run across or down and may
//   touch but not overlap.
// - Firing (sequential): players take turns calling one square of the other's
//   grid, hit or miss — one shot per turn. A ship sinks once every square of
//   it has been hit, and sinking the whole enemy fleet wins. Who fires first
//   is drawn from the seeded PRNG.
//
// The opponent's fleet is the secret here, so `view()` sends each player only
// their own ships, plus every enemy ship they have already sunk, until the
// match is over.

export const SIZE = 10;
export const CELLS = SIZE * SIZE;

// A turn auto-plays after 24h, the same turn timeout every sequential game
// uses. Placing gets the same 24h, counted from the first fleet placed.
export const TURN_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export type ShipId = "carrier" | "battleship" | "cruiser" | "submarine" | "destroyer";

export const FLEET: ReadonlyArray<{ id: ShipId; length: number }> = [
  { id: "carrier", length: 5 },
  { id: "battleship", length: 4 },
  { id: "cruiser", length: 3 },
  { id: "submarine", length: 3 },
  { id: "destroyer", length: 2 },
];

export type Seat = 0 | 1;

// Where one ship lies. `row`/`col` is its top-left end, and it runs right
// from there, or down when `vertical`.
export interface Placement {
  row: number;
  col: number;
  vertical: boolean;
}

// One placement per ship, in `FLEET` order.
export type Fleet = Placement[];

export interface BattleshipState {
  players: [PlayerId, PlayerId];
  phase: "placing" | "firing";
  fleets: [Fleet | null, Fleet | null];
  shots: [number[], number[]]; // shots[seat] = cells that seat has fired at, in order
  turn: Seat; // who fires next, once firing
  turnNo: number; // shots fired so far
  lastShot: { by: Seat; cell: number } | null;
  winner: Seat | null;
  placingStartedAt: number; // 0 until the first fleet is placed
  turnStartedAt: number;
  rng: number;
}

export type PlaceAction = { t: "place"; ships: Fleet };
export type FireAction = { t: "fire"; cell: number };
export type BattleshipAction = PlaceAction | FireAction;

const PlacementSchema = z.object({
  row: z
    .number()
    .int()
    .min(0)
    .max(SIZE - 1),
  col: z
    .number()
    .int()
    .min(0)
    .max(SIZE - 1),
  vertical: z.boolean(),
});

export const BattleshipActionSchema: z.ZodType<BattleshipAction> = z.discriminatedUnion("t", [
  z.object({ t: z.literal("place"), ships: z.array(PlacementSchema).length(FLEET.length) }),
  z.object({
    t: z.literal("fire"),
    cell: z
      .number()
      .int()
      .min(0)
      .max(CELLS - 1),
  }),
]);

// What one player is sent. Only ever this player's own fleet, and the other's
// once the match is over; `sunk` carries the enemy ships already sunk, whose
// every square the shooter has hit anyway.
export interface ShotView {
  cell: number;
  hit: boolean;
}

export interface SunkShip extends Placement {
  ship: ShipId;
}

export interface BattleshipView {
  phase: "placing" | "firing" | "over";
  players: [PlayerId, PlayerId];
  you: Seat | "spectator";
  ready: [boolean, boolean];
  fleets: [Fleet | null, Fleet | null];
  shots: [ShotView[], ShotView[]]; // shots[seat] = what that seat fired, at the other's waters
  sunk: [SunkShip[], SunkShip[]]; // sunk[seat] = that seat's ships that have gone down
  turn: Seat | null;
  yourTurn: boolean;
  turnNo: number;
  lastShot: { by: Seat; cell: number; hit: boolean; sunk: ShipId | null } | null;
  winner: Seat | null;
}

function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

function isOver(state: BattleshipState): boolean {
  return state.winner !== null;
}

function seatOf(state: BattleshipState, player: PlayerId): Seat | null {
  if (state.players[0] === player) return 0;
  if (state.players[1] === player) return 1;
  return null;
}

// The squares one ship covers, bow first, or null if it runs off the board.
export function shipCells(placement: Placement, length: number): number[] | null {
  const { row, col, vertical } = placement;
  if (vertical ? row + length > SIZE : col + length > SIZE) return null;
  return Array.from({ length }, (_, i) =>
    vertical ? (row + i) * SIZE + col : row * SIZE + col + i,
  );
}

// Every ship's squares, in `FLEET` order, or null if the fleet is not a legal
// layout: the wrong number of ships, a ship off the board, or two ships
// sharing a square.
export function fleetCells(fleet: Fleet): number[][] | null {
  if (fleet.length !== FLEET.length) return null;
  const taken = new Set<number>();
  const ships: number[][] = [];
  for (const [i, { length }] of FLEET.entries()) {
    const cells = shipCells(fleet[i], length);
    if (cells === null || cells.some((cell) => taken.has(cell))) return null;
    for (const cell of cells) taken.add(cell);
    ships.push(cells);
  }
  return ships;
}

// A uniformly random legal layout, ship by ship: each ship picks one of the
// spots still open to it. The board is far too big for the five ships to box
// one another out, so every ship always has somewhere to go.
export function randomFleet(seed: number): [fleet: Fleet, next: number] {
  const taken = new Set<number>();
  const fleet: Fleet = [];
  let rng = seed;
  for (const { length } of FLEET) {
    const spots: Array<{ placement: Placement; cells: number[] }> = [];
    for (const vertical of [false, true]) {
      for (let row = 0; row < SIZE; row++) {
        for (let col = 0; col < SIZE; col++) {
          const placement = { row, col, vertical };
          const cells = shipCells(placement, length);
          if (cells && !cells.some((cell) => taken.has(cell))) spots.push({ placement, cells });
        }
      }
    }
    const [pick, next] = nextInt(rng, spots.length);
    rng = next;
    fleet.push(spots[pick].placement);
    for (const cell of spots[pick].cells) taken.add(cell);
  }
  return [fleet, rng];
}

export function init(players: PlayerId[], seed: number): BattleshipState {
  if (players.length !== 2) {
    throw new Error("battleship requires exactly 2 players");
  }
  // Who fires first comes from the seeded PRNG, never Math.random(); the
  // advanced rng is kept for `onDeadline`'s auto-placement and auto-shots.
  const [first, rng] = nextInt(seed, 2);
  return {
    players: [players[0], players[1]],
    phase: "placing",
    fleets: [null, null],
    shots: [[], []],
    turn: first as Seat,
    turnNo: 0,
    lastShot: null,
    winner: null,
    // `init()` gets no `now`, so neither clock can start here. Placing is
    // untimed until the first fleet lands, and the first turn's clock starts
    // the moment the second one does.
    placingStartedAt: 0,
    turnStartedAt: 0,
    rng,
  };
}

// Stores `seat`'s fleet, and starts the shooting once both are down.
function placeFleet(
  state: BattleshipState,
  seat: Seat,
  fleet: Fleet,
  now: number,
): BattleshipState {
  const fleets: [Fleet | null, Fleet | null] = [state.fleets[0], state.fleets[1]];
  fleets[seat] = fleet.map((ship) => ({ ...ship }));
  const placed: BattleshipState = {
    ...state,
    fleets,
    placingStartedAt: state.placingStartedAt === 0 ? now : state.placingStartedAt,
  };
  if (fleets[0] === null || fleets[1] === null) return placed;
  return { ...placed, phase: "firing", turnStartedAt: now };
}

// The ship of `fleet` that covers `cell`, with all its squares, or null for
// open water.
function shipAt(fleet: Fleet, cell: number): { ship: ShipId; cells: number[] } | null {
  for (const [i, { id, length }] of FLEET.entries()) {
    const cells = shipCells(fleet[i], length);
    if (cells?.includes(cell)) return { ship: id, cells };
  }
  return null;
}

// What a shot at `cell` by `by` does: whether it hits, and the ship it
// finishes off, if any. Counts `cell` as fired at whether or not
// `state.shots` already has it.
function shotOutcome(
  state: BattleshipState,
  by: Seat,
  cell: number,
): { hit: boolean; sunk: ShipId | null } {
  const fleet = state.fleets[other(by)];
  const hitShip = fleet ? shipAt(fleet, cell) : null;
  if (!hitShip) return { hit: false, sunk: null };
  const fired = new Set([...state.shots[by], cell]);
  return { hit: true, sunk: hitShip.cells.every((c) => fired.has(c)) ? hitShip.ship : null };
}

function allSunk(fleet: Fleet, fired: number[]): boolean {
  const hits = new Set(fired);
  return (fleetCells(fleet) ?? []).every((cells) => cells.every((cell) => hits.has(cell)));
}

function fire(state: BattleshipState, cell: number, now: number): BattleshipState {
  const by = state.turn;
  if (state.shots[by].includes(cell)) {
    throw new Error("you have already fired at that square");
  }
  const shots: [number[], number[]] = [state.shots[0].slice(), state.shots[1].slice()];
  shots[by].push(cell);
  const won = allSunk(state.fleets[other(by)] as Fleet, shots[by]);
  return {
    ...state,
    shots,
    turn: other(by),
    turnNo: state.turnNo + 1,
    lastShot: { by, cell },
    winner: won ? by : null,
    turnStartedAt: now,
  };
}

export function reduce(
  state: BattleshipState,
  action: BattleshipAction,
  by: PlayerId,
  now: number,
): BattleshipState {
  if (isOver(state)) {
    throw new Error("match already finished");
  }
  const seat = seatOf(state, by);
  if (seat === null) {
    throw new Error("not a player in this match");
  }

  if (action.t === "place") {
    if (state.phase !== "placing") {
      throw new Error("the fleets are already placed");
    }
    if (state.fleets[seat] !== null) {
      throw new Error("you have already placed your fleet");
    }
    if (fleetCells(action.ships) === null) {
      throw new Error("ships must fit on the board without overlapping");
    }
    return placeFleet(state, seat, action.ships, now);
  }

  if (state.phase !== "firing") {
    throw new Error("wait for both fleets to be placed");
  }
  if (seat !== state.turn) {
    throw new Error("not your turn");
  }
  return fire(state, action.cell, now);
}

// Each shot of `seat`'s, with whether it hit.
function shotsOf(state: BattleshipState, seat: Seat): ShotView[] {
  const fleet = state.fleets[other(seat)];
  const occupied = new Set(fleet ? (fleetCells(fleet) ?? []).flat() : []);
  return state.shots[seat].map((cell) => ({ cell, hit: occupied.has(cell) }));
}

// `seat`'s ships that every shot at them has sunk.
function sunkShips(state: BattleshipState, seat: Seat): SunkShip[] {
  const fleet = state.fleets[seat];
  if (!fleet) return [];
  const hits = new Set(state.shots[other(seat)]);
  const sunk: SunkShip[] = [];
  for (const [i, { id, length }] of FLEET.entries()) {
    const cells = shipCells(fleet[i], length) ?? [];
    if (cells.every((cell) => hits.has(cell))) sunk.push({ ship: id, ...fleet[i] });
  }
  return sunk;
}

export function view(state: BattleshipState, forPlayer: PlayerId): BattleshipView {
  const seat = seatOf(state, forPlayer);
  const over = isOver(state);
  const firing = !over && state.phase === "firing";
  // A fleet leaves the server only for its owner, until the match is over and
  // there is nothing left to hide.
  const fleetFor = (owner: Seat): Fleet | null => {
    const fleet = state.fleets[owner];
    return fleet && (over || owner === seat) ? fleet.map((ship) => ({ ...ship })) : null;
  };

  // A square is fired at once at most, so the ship the last shot hit went
  // down with that shot exactly when it is down now.
  const lastShot = state.lastShot && {
    ...state.lastShot,
    ...shotOutcome(state, state.lastShot.by, state.lastShot.cell),
  };

  return {
    phase: over ? "over" : state.phase,
    players: [state.players[0], state.players[1]],
    you: seat ?? "spectator",
    ready: [state.fleets[0] !== null, state.fleets[1] !== null],
    fleets: [fleetFor(0), fleetFor(1)],
    shots: [shotsOf(state, 0), shotsOf(state, 1)],
    sunk: [sunkShips(state, 0), sunkShips(state, 1)],
    turn: firing ? state.turn : null,
    yourTurn: firing && seat === state.turn,
    turnNo: state.turnNo,
    lastShot,
    winner: state.winner,
  };
}

export function waitingOn(state: BattleshipState): PlayerId[] {
  if (isOver(state)) return [];
  if (state.phase === "placing") {
    return state.players.filter((_, seat) => state.fleets[seat] === null);
  }
  return [state.players[state.turn]];
}

export function deadline(state: BattleshipState): number | null {
  if (isOver(state)) return null;
  if (state.phase === "placing") {
    // Untimed until someone has placed: a deadline counted from the `0`
    // sentinel (a moment in 1970) would fire the alarm at once and place
    // both fleets at random before either player had looked.
    if (state.placingStartedAt === 0) return null;
    return state.placingStartedAt + TURN_TIMEOUT_MS;
  }
  return state.turnStartedAt + TURN_TIMEOUT_MS;
}

export function onDeadline(state: BattleshipState, now: number): BattleshipState {
  if (isOver(state)) return state;

  // Idempotent, keyed on the deadline itself: placing the missing fleets
  // starts the first turn's clock at `now`, and every shot restarts it at
  // `now`, so re-running with the same (or an earlier) `now` on either the
  // original state or its own output is a no-op.
  const due = deadline(state);
  if (due === null || now < due) return state;

  if (state.phase === "placing") {
    // Whoever has not placed gets a random fleet, and the shooting starts.
    let next = state;
    for (const seat of [0, 1] as const) {
      if (next.fleets[seat] !== null) continue;
      const [fleet, rng] = randomFleet(next.rng);
      next = placeFleet({ ...next, rng }, seat, fleet, now);
    }
    return next;
  }

  const fired = new Set(state.shots[state.turn]);
  const open: number[] = [];
  for (let cell = 0; cell < CELLS; cell++) {
    if (!fired.has(cell)) open.push(cell);
  }
  // Unreachable in practice: a player who has fired at every square has sunk
  // every ship. But do not leave a live match with no legal move.
  if (open.length === 0) return { ...state, winner: state.turn };

  const [pick, rng] = nextInt(state.rng, open.length);
  return fire({ ...state, rng }, open[pick], now);
}

export function result(state: BattleshipState): Result | null {
  if (state.winner === null) return null;
  return { kind: "win", winners: [state.players[state.winner]] };
}

// A square's name, row letter then column number: "A1" is the top-left
// corner, "J10" the bottom-right. Neither player's grid is ever drawn turned
// round, so both read a name the same way.
export function cellName(cell: number): string {
  const row = Math.floor(cell / SIZE);
  const col = cell % SIZE;
  return `${String.fromCharCode("A".charCodeAt(0) + row)}${col + 1}`;
}

// A placed fleet is described without a single square of it: the history is
// broadcast to both players. A shot's outcome is public the moment it lands,
// so its description names the hit and any ship it sinks.
export function describeAction(
  state: BattleshipState,
  action: BattleshipAction,
  by: PlayerId,
): ActionDescription {
  if (action.t === "place") return { key: "history.placed" };

  const seat = seatOf(state, by) ?? state.turn;
  const values = { cell: cellName(action.cell) };
  const { hit, sunk } = shotOutcome(state, seat, action.cell);
  if (sunk) return { key: `history.sunk.${sunk}`, values };
  return { key: hit ? "history.hit" : "history.miss", values };
}

export const battleshipGame: GameModule<BattleshipState, BattleshipAction> = {
  id: "battleship",
  meta: { name: "Battleship", minPlayers: 2, maxPlayers: 2 },
  actionSchema: BattleshipActionSchema,
  init,
  reduce,
  view,
  waitingOn,
  deadline,
  onDeadline,
  result,
  describeAction,
};
