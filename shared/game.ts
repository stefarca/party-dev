import type { z } from "zod";

import type { PlayerId } from "./protocol";

// The binding interface (PLAN.md §5), reproduced verbatim, plus one
// deliberate, documented addition: `actionSchema`. §5 rule 1 requires every
// inbound message to be zod-validated; without a per-game schema on the
// module itself, `MatchDO` would have to know each game's action shape to
// validate it, which defeats "one DO class for all games" (§3). Requiring
// every `GameModule` to carry its own `actionSchema` lets the DO validate an
// untyped inbound `action` payload before ever calling `reduce`, with zero
// game-specific knowledge.
export interface GameModule<S, A> {
  id: string;
  meta: GameMeta;
  actionSchema: z.ZodType<A>;

  init(players: PlayerId[], seed: number): S;
  reduce(state: S, action: A, by: PlayerId, now: number): S; // pure + deterministic
  view(state: S, forPlayer: PlayerId): unknown; // per-player projection

  // async
  waitingOn(state: S): PlayerId[]; // [] when finished
  deadline(state: S): number | null; // epoch ms -> schedules the DO alarm
  // Must be idempotent (§5 rule 4, §10.6): alarms are at-least-once with up
  // to 6 retries on throw. Key the resolution on the round/phase number
  // inside `state` and no-op if that round has already resolved — re-running
  // `onDeadline` on an already-resolved round must return state that is
  // unchanged in every observable way (same `deadline()`, same `result()`),
  // or a transient failure elsewhere in the pipeline can double-resolve a
  // round when the platform retries the alarm.
  onDeadline(state: S, now: number): S; // auto-submit / skip / resolve round
  result(state: S): Result | null; // non-null => archive
}

export interface GameMeta {
  name: string;
  minPlayers: number;
  maxPlayers: number;
}

export type Result =
  | { kind: "win"; winners: PlayerId[] }
  | { kind: "draw" }
  | { kind: "scores"; scores: Record<PlayerId, number> };
