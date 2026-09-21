import type { z } from "zod";

import type { PlayerId } from "./protocol";

// The binding game interfaces: `GameModule` for a match between players and
// `DailyGameModule` (below) for the daily single-player games.
//
// `GameModule` makes one deliberate addition to the binding shape: `actionSchema`.
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

// A daily game: one player, one run a day, on a board every player gets that
// day, ranked against everyone else's run on the day's chart. `DailyDO`
// (worker/daily.ts) runs it, not `MatchDO`: there is no lobby, no turn to
// wait on and nobody to nudge.
//
// The rules that bind a `GameModule` bind this too, less the ones about
// other players. The server is the authority: `reduce` is the only thing
// that produces state, and it throws to reject an illegal action. Randomness
// comes from `shared/prng.ts`, seeded with `init`'s `seed` and threaded
// through state. And `view()` hides whatever the player must not see, which
// for a daily game means the PRNG state above all: the day's whole board
// follows from it, and the seed is the same for every player.
export interface DailyGameModule<S, A> {
  id: string;
  meta: DailyGameMeta;
  actionSchema: z.ZodType<A>;

  // `seed` is the day's, the same for every player; `now` is when this
  // player's run starts.
  init(seed: number, now: number): S;
  reduce(state: S, action: A, now: number): S; // pure + deterministic
  view(state: S): unknown;

  // Whether the run has ended by the game's own rules: solved, stuck, out of
  // moves. A run still going when its day ends, or that its player ends
  // early, is closed by the engine as it stands, without asking the game.
  finished(state: S): boolean;
  // What the run scores as it stands. Called on finished runs and on runs
  // closed early alike, so a game that ranks only completed runs (a puzzle
  // ranked by solving time, say) returns a null `value` for the others.
  score(state: S): DailyScore;
}

export interface DailyGameMeta {
  name: string;
  // Which way the chart ranks `DailyScore.value`: "desc" puts the biggest
  // first (points), "asc" the smallest (a time, a move count).
  order: "asc" | "desc";
  // How a score reads: a plain count, or a duration in milliseconds.
  format: "number" | "duration";
}

export interface DailyScore {
  // What the chart ranks by. Null for a run that ended without a rankable
  // result, which is listed after every ranked run.
  value: number | null;
  // One line the chart shows under the player's name: a key in the game's
  // own namespace plus its interpolations, the same shape as a move's
  // description.
  detail?: ActionDescription;
}
