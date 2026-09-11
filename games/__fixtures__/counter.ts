import { z } from "zod";

import { nextInt } from "../../shared/prng";
import type { GameModule, Result } from "../../shared/game";
import type { PlayerId } from "../../shared/protocol";

// Test-only fixture game (PLAN.md §12 step 13). Deliberately NOT registered
// in games/registry.ts — it exists purely to exercise both phase types from
// PLAN.md §4 against a real GameModule implementation:
//
//   1. "sequential" — each player increments a shared counter once, in turn
//      order (proves the sequential phase / turn handoff).
//   2. "simultaneous" — every remaining player submits a `pick` at once,
//      with a deadline; non-submitters get 0 on `onDeadline` (proves the
//      simultaneous + deadline phase and auto-resolve).
//
// `secret` is a per-player hidden field with no gameplay purpose beyond
// proving `view()` never leaks another player's private data.

export const ROUND_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export type CounterPhase = "sequential" | "simultaneous" | "done";

export interface CounterState {
  players: PlayerId[];
  phase: CounterPhase;
  total: number;
  turnIndex: number;
  sequentialTurns: number;
  picks: Record<PlayerId, number>;
  roundStartedAt: number;
  secret: Record<PlayerId, number>;
  rng: number;
}

export type CounterAction = { t: "increment" } | { t: "pick"; value: number };

export const CounterActionSchema: z.ZodType<CounterAction> = z.discriminatedUnion("t", [
  z.object({ t: z.literal("increment") }),
  z.object({ t: z.literal("pick"), value: z.number().int().min(0).max(100) }),
]);

export function waitingOn(state: CounterState): PlayerId[] {
  if (state.phase === "sequential") return [state.players[state.turnIndex]];
  if (state.phase === "simultaneous") {
    return state.players.filter((p) => !(p in state.picks));
  }
  return [];
}

export function deadline(state: CounterState): number | null {
  return state.phase === "simultaneous" ? state.roundStartedAt + ROUND_TIMEOUT_MS : null;
}

// Sums every player's pick (defaulting missing ones to 0) and moves the
// match to "done". Shared by both the "all picked" branch of reduce() and
// onDeadline(), so the two paths cannot disagree about how a round resolves.
function finalizeSimultaneous(state: CounterState): CounterState {
  const picks: Record<PlayerId, number> = { ...state.picks };
  for (const p of state.players) {
    if (!(p in picks)) picks[p] = 0;
  }
  const sum = Object.values(picks).reduce((a, b) => a + b, 0);
  return { ...state, picks, phase: "done", total: state.total + sum };
}

export function init(players: PlayerId[], seed: number): CounterState {
  if (players.length < 2) {
    throw new Error("counter fixture needs at least 2 players");
  }
  let rng = seed;
  const secret: Record<PlayerId, number> = {};
  for (const p of players) {
    const [value, next] = nextInt(rng, 100);
    secret[p] = value;
    rng = next;
  }
  return {
    players: [...players],
    phase: "sequential",
    total: 0,
    turnIndex: 0,
    sequentialTurns: 0,
    picks: {},
    roundStartedAt: 0,
    secret,
    rng,
  };
}

export function reduce(
  state: CounterState,
  action: CounterAction,
  by: PlayerId,
  now: number
): CounterState {
  if (state.phase === "done") {
    throw new Error("match already finished");
  }

  if (action.t === "increment") {
    if (state.phase !== "sequential") throw new Error("not the sequential phase");
    if (by !== state.players[state.turnIndex]) throw new Error("not your turn");

    const turnIndex = (state.turnIndex + 1) % state.players.length;
    const sequentialTurns = state.sequentialTurns + 1;
    const finishedSequential = sequentialTurns === state.players.length;

    return {
      ...state,
      total: state.total + 1,
      turnIndex,
      sequentialTurns,
      phase: finishedSequential ? "simultaneous" : "sequential",
      roundStartedAt: finishedSequential ? now : state.roundStartedAt,
    };
  }

  // action.t === "pick"
  if (state.phase !== "simultaneous") throw new Error("not the simultaneous phase");
  if (!state.players.includes(by)) throw new Error("not a player in this match");
  if (by in state.picks) throw new Error("already picked this round");

  const picks = { ...state.picks, [by]: action.value };
  if (Object.keys(picks).length === state.players.length) {
    return finalizeSimultaneous({ ...state, picks });
  }
  return { ...state, picks };
}

export function view(state: CounterState, forPlayer: PlayerId): unknown {
  return {
    phase: state.phase,
    total: state.total,
    turnIndex: state.turnIndex,
    picks: { ...state.picks },
    // Only ever this player's own secret — never the whole `secret` map.
    mySecret: state.secret[forPlayer] ?? null,
    deadline: deadline(state),
  };
}

export function onDeadline(state: CounterState, _now: number): CounterState {
  if (state.phase !== "simultaneous") return state;
  return finalizeSimultaneous(state);
}

export function result(state: CounterState): Result | null {
  if (state.phase !== "done") return null;
  return { kind: "scores", scores: { ...state.picks } };
}

export const counterGame: GameModule<CounterState, CounterAction> = {
  id: "counter",
  meta: { name: "Counter (fixture)", minPlayers: 2, maxPlayers: 4 },
  actionSchema: CounterActionSchema,
  init,
  reduce,
  view,
  waitingOn,
  deadline,
  onDeadline,
  result,
};
