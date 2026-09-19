import type { z } from "zod";

import type { PlayerId } from "./protocol";

// The binding game interface, plus one deliberate addition: `actionSchema`.
// Server authority requires every inbound message to be zod-validated;
// without a per-game schema on the module itself, `MatchDO` would have to
// know each game's action shape to validate it, which defeats "one DO class
// for all games". Requiring every `GameModule` to carry its own
// `actionSchema` lets the DO validate an untyped inbound `action` payload
// before ever calling `reduce`, with zero game-specific knowledge.
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
  // Must be idempotent: alarms are at-least-once with up
  // to 6 retries on throw. Key the resolution on the round/phase number
  // inside `state` and no-op if that round has already resolved — re-running
  // `onDeadline` on an already-resolved round must return state that is
  // unchanged in every observable way (same `deadline()`, same `result()`),
  // or a transient failure elsewhere in the pipeline can double-resolve a
  // round when the platform retries the alarm.
  onDeadline(state: S, now: number): S; // auto-submit / skip / resolve round
  result(state: S): Result | null; // non-null => archive

  // Optional. Turns one action into the line the match history shows for
  // it. Called with the state the action was played against (i.e. *before*
  // `reduce` applies it), so a description can name what was already there.
  //
  // A game that implements this keeps its raw actions out of the event log
  // entirely — the log stores the description instead. That is what lets a
  // simultaneous game describe a move without leaking it: everyone sees
  // "Ada answered", nobody sees which choice, until the state itself
  // reveals it.
  describeAction?(state: S, action: A, by: PlayerId): ActionDescription;
}

// One logged action, in a form the client can render as a sentence.
//
// `key` is a key inside the game's own i18n namespace (so the string lives
// in `games/<id>/locales/<lng>.json` next to the rest of that game), and
// `values` are its interpolations. The renderer supplies `name` — the
// player's nickname — itself; a game module knows player *ids*, never
// nicknames, and the log would go stale on a rename if it stored them.
export interface ActionDescription {
  key: string;
  values?: Record<string, string | number>;
}

export interface GameMeta {
  name: string;
  minPlayers: number;
  maxPlayers: number;
  // Still listed, but greyed out and shelved after every playable game, and
  // `POST /api/matches` refuses to start a new match of it. The module stays
  // registered, so matches already in flight keep running to the end.
  comingSoon?: boolean;
}

export type Result =
  | { kind: "win"; winners: PlayerId[] }
  | { kind: "draw" }
  | { kind: "scores"; scores: Record<PlayerId, number> };
