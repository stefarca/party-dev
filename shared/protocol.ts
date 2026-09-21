import { z } from "zod";

import { decodeBase64Url } from "./base64url";
import type { ActionDescription, DailyScore, Result } from "./game";
import { NICKNAME_MAX_LENGTH } from "./nickname";

// The single home for cross-boundary types and zod schemas.
// Server authority is binding here: every inbound payload — REST bodies
// included, not just future WS messages — is validated with a schema from
// this file, never trusted as-is.
//
// This file and shared/game.ts have a type-only circular reference
// (`GameModule` needs `PlayerId` from here; `MatchSnapshot`/`GameUiProps`
// here need `Result` from there). `import type` erases entirely at build
// time, so there is no runtime cycle — only TypeScript's type checker needs
// to resolve both, which it does fine.

export type PlayerId = string;

export type MatchStatus = "lobby" | "active" | "done";

// Who can join a lobby. Anyone with the code can join either kind; a public
// one is also listed on every player's hub, so nobody needs the code.
export const MatchVisibilitySchema = z.enum(["private", "public"]);
export type MatchVisibility = z.infer<typeof MatchVisibilitySchema>;

export interface PlayerInfo {
  id: PlayerId;
  nickname: string;
}

export interface MatchSummary {
  id: string;
  gameId: string;
  status: MatchStatus;
  players: PlayerInfo[];
  hostId: PlayerId;
  waiting: boolean;
  updatedAt: number;
  deadline: number | null;
  visibility: MatchVisibility;
}

// No control characters (U+0000-U+001F, U+007F). Coworkers will open
// devtools, so the nickname is validated server-side regardless of what the
// client UI already enforces.
// eslint-disable-next-line no-control-regex -- control chars are the point of this validation
const NO_CONTROL_CHARS = /^[^\x00-\x1F\x7F]*$/;

export const IdentityRequestSchema = z.object({
  nickname: z
    .string()
    .trim()
    .min(1, "nickname is required")
    .max(NICKNAME_MAX_LENGTH, `nickname must be ${NICKNAME_MAX_LENGTH} characters or fewer`)
    .regex(NO_CONTROL_CHARS, "nickname must not contain control characters"),
});
export type IdentityRequest = z.infer<typeof IdentityRequestSchema>;

// A match is private unless the host asks otherwise, so a client that never
// sends `visibility` keeps getting the invite-only matches it always did.
export const CreateMatchRequestSchema = z.object({
  gameId: z.string().min(1, "gameId is required"),
  visibility: MatchVisibilitySchema.default("private"),
});
export type CreateMatchRequest = z.infer<typeof CreateMatchRequestSchema>;

// Body of POST /api/matches/:id/visibility. Only the host may send it, and
// only while the match is still a lobby.
export const SetVisibilityRequestSchema = z.object({ visibility: MatchVisibilitySchema });
export type SetVisibilityRequest = z.infer<typeof SetVisibilityRequestSchema>;

// Joining takes no body; the schema exists (and every request is still run
// through it) so an unexpected/extra payload gets a 400 like everything
// else, rather than being silently ignored.
export const JoinMatchRequestSchema = z.object({}).strict();
export type JoinMatchRequest = z.infer<typeof JoinMatchRequestSchema>;

// Body of the HTTP action fallback (POST /api/matches/:id/actions) — mirrors
// the WS `{ t: "action", action }` message's payload one-for-one.
export const ActionRequestSchema = z.object({ action: z.unknown() });
export type ActionRequest = z.infer<typeof ActionRequestSchema>;

// Body of the HTTP start fallback (POST /api/matches/:id/start) —
// mirrors the WS `{ t: "start" }` message, which itself carries no payload.
// Takes no body, same reasoning as JoinMatchRequestSchema above: still run
// through a schema so an unexpected/extra payload gets a 400 rather than
// being silently ignored.
export const StartMatchRequestSchema = z.object({}).strict();
export type StartMatchRequest = z.infer<typeof StartMatchRequestSchema>;

// ---------------------------------------------------------------------------
// Web push subscriptions. A browser hands the app an endpoint plus two keys
// when a player opts in; worker/push.ts encrypts to those keys and POSTs to
// that endpoint.
// ---------------------------------------------------------------------------

// The endpoint is supplied by the client and then fetched by the Worker, so
// it is validated harder than a field that only gets stored. Its host cannot
// be checked against a list — it is whatever push service the browser's
// vendor runs — but its scheme can, and `https:` is the whole of what the
// standard allows.
const PushEndpointSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "endpoint must be an https URL");

// A base64url field of an exact size. The two key sizes RFC 8291 fixes are
// checked here, at the boundary, rather than when a notification is sent:
// key material the Worker cannot encrypt to would otherwise sit in the
// registry as a row it retries every turn, forever, with nothing to learn
// from the failure — unlike a subscription a push service reports as gone.
function base64UrlBytes(bytes: number, check?: (decoded: Uint8Array) => boolean) {
  return z.string().refine((value) => {
    let decoded: Uint8Array;
    try {
      decoded = decodeBase64Url(value);
    } catch {
      return false;
    }
    return decoded.length === bytes && (check?.(decoded) ?? true);
  }, `must be ${bytes} base64url-encoded bytes`);
}

// Exactly the shape `PushSubscription.toJSON()` produces in the browser,
// minus the fields nothing here reads, so the client can forward it as-is.
export const PushSubscriptionSchema = z.object({
  endpoint: PushEndpointSchema,
  keys: z.object({
    // The browser's own public key: an uncompressed P-256 point, which is
    // what the leading 0x04 says it is.
    p256dh: base64UrlBytes(65, (key) => key[0] === 0x04),
    auth: base64UrlBytes(16),
  }),
});
export type PushSubscriptionPayload = z.infer<typeof PushSubscriptionSchema>;

export const PushSubscribeRequestSchema = z.object({
  subscription: PushSubscriptionSchema,
  // Which language to compose this device's notifications in. Optional: the
  // service worker re-subscribes without knowing it (it has no i18next), and
  // the server then keeps whatever the row already said.
  language: z.string().min(2).max(16).optional(),
  // An endpoint this one supersedes, when a push service retired the old one
  // and the service worker subscribed again in its place.
  replaces: PushEndpointSchema.optional(),
});
export type PushSubscribeRequest = z.infer<typeof PushSubscribeRequestSchema>;

export const PushUnsubscribeRequestSchema = z.object({ endpoint: PushEndpointSchema });
export type PushUnsubscribeRequest = z.infer<typeof PushUnsubscribeRequestSchema>;

// Reply to GET /api/push/key. `key` is the VAPID public key a browser must
// create its subscription with, or null where this deployment has none
// configured and can send nothing.
export interface PushKeyResponse {
  key: string | null;
}

// ---------------------------------------------------------------------------
// Live match wire protocol. Used by both the WebSocket at
// `/ws/:id` and the HTTP fallbacks (`GET /api/matches/:id/snapshot`,
// `POST /api/matches/:id/actions`) — binding rule: "treat WS as an
// optimization over 'fetch state on load', never as the only path", so both
// transports must speak the exact same message/snapshot shapes.
// ---------------------------------------------------------------------------

// Client -> server. Every one of these is zod-validated by MatchDO before
// it is trusted — the client sends *intents*, never state.
export const HelloMessageSchema = z.object({
  t: z.literal("hello"),
  since: z.number().int().min(0),
});

export const ActionMessageSchema = z.object({
  t: z.literal("action"),
  // Deliberately `unknown` here: MatchDO does not know any game's action
  // shape. Each `GameModule.actionSchema` re-validates this payload before
  // it ever reaches `reduce()`.
  action: z.unknown(),
});

export const StartMessageSchema = z.object({ t: z.literal("start") });

export const PingMessageSchema = z.object({ t: z.literal("ping") });

export const ClientMessageSchema = z.discriminatedUnion("t", [
  HelloMessageSchema,
  ActionMessageSchema,
  StartMessageSchema,
  PingMessageSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// Server -> client.

// The event log's payloads. Closed on purpose: the history panel renders
// every one of these as a sentence, so a new kind of event has to be given
// its wording here and in web/locales/ before it can be appended.
//
// An `action` carries the game's own `describe` (see `ActionDescription`)
// when the module implements `describeAction`, and the raw `action` only
// when it does not. It is never both: a described action's payload is the
// only thing broadcast, which is what keeps a hidden move (a trivia answer
// before its reveal) out of every other player's event stream.
export type MatchEventPayload =
  | { type: "player_joined"; id: PlayerId }
  | { type: "match_started" }
  | { type: "action"; by: PlayerId; describe: ActionDescription }
  | { type: "action"; by: PlayerId; action: unknown }
  | { type: "deadline_resolved"; round: number }
  | { type: "match_finished"; result: Result };

export interface MatchEvent {
  seq: number;
  ts: number;
  payload: MatchEventPayload;
}

// The shape shared by the WS `snapshot` message and the HTTP snapshot
// route's JSON body. `view` is always this player's own `view()`
// projection (or `null` before the game has started) — never raw state.
export interface MatchSnapshot {
  seq: number;
  status: MatchStatus;
  players: PlayerInfo[];
  view: unknown;
  waitingOn: PlayerId[];
  deadline: number | null;
  result: Result | null;
}

export interface SnapshotMessage extends MatchSnapshot {
  t: "snapshot";
}

export interface EventsMessage {
  t: "events";
  events: MatchEvent[];
}

// Body of the HTTP history route (`GET /api/matches/:id/events`) — the
// same `MatchEvent[]` the WS `events` message carries. Without it the event
// log would be reachable over the socket only, and a reload (which starts
// with no history and a `since` already at the latest seq) would show an
// empty panel until the next move.
export interface EventsResponse {
  events: MatchEvent[];
}

export interface ErrorMessage {
  t: "error";
  code: string;
  message: string;
}

export interface PongMessage {
  t: "pong";
}

export type ServerMessage = SnapshotMessage | EventsMessage | ErrorMessage | PongMessage;

// ---------------------------------------------------------------------------
// Daily games: one run per player per day, on the board everyone gets that
// day, ranked on the day's chart. `DailyDO` (worker/daily.ts) holds each run;
// the chart is read from the `daily_runs` index (worker/chart.ts). Plain
// HTTP only — a run has a single player, so there is nobody else's move to
// push to it.
// ---------------------------------------------------------------------------

export type DailyRunStatus = "active" | "done";

// A player's run as they see it. Shared by every daily route that returns a
// run, the way `MatchSnapshot` is by the match routes: `view` is the game's
// own `view()`, never raw state.
export interface DailyRunSnapshot {
  gameId: string;
  day: string;
  status: DailyRunStatus;
  view: unknown;
  // What the run scores as it stands; final once `status` is "done".
  score: DailyScore;
  startedAt: number;
  finishedAt: number | null;
  // When the day ends, and a run still going with it.
  endsAt: number;
}

// Reply to GET /api/daily/:gameId and POST /api/daily/:gameId/start: today,
// by the server's clock, and the caller's run on it, if they have one.
export interface DailyToday {
  day: string;
  endsAt: number;
  run: DailyRunSnapshot | null;
}

// One finished run on a day's chart. Names come from the player registry
// when the chart is read, like every roster.
export interface DailyChartEntry {
  playerId: PlayerId;
  nickname: string;
  status: DailyRunStatus;
  // Equal scores share a rank. Null for a run with no rankable score, or one
  // still going.
  rank: number | null;
  score: number | null;
  detail: ActionDescription | null;
  finishedAt: number | null;
}

// Reply to GET /api/daily/:gameId/:day/chart.
export interface DailyChart {
  gameId: string;
  day: string;
  // The finished runs, best first, at most a page of them.
  entries: DailyChartEntry[];
  // The caller's own run, wherever it placed, so it can be shown even when it
  // is not in `entries`. Null if they have none that day.
  mine: DailyChartEntry | null;
  // How many runs are on the chart, and how many are still going.
  finished: number;
  playing: number;
}

// One daily game on the hub.
export interface DailyGameSummary {
  gameId: string;
  // The caller's run today, or null until they start one.
  mine: { status: DailyRunStatus; score: number | null; rank: number | null } | null;
  finished: number;
  // Whoever tops today's chart, or null before anyone has a ranked score.
  leader: { playerId: PlayerId; nickname: string; score: number } | null;
}

// Reply to GET /api/daily.
export interface DailyHub {
  day: string;
  endsAt: number;
  games: DailyGameSummary[];
}

// Bodies of POST /api/daily/:gameId/start and /api/daily/:gameId/:day/finish.
// Neither takes one; both still run the body through a schema, like the match
// routes that take none, so an unexpected payload is a 400 rather than
// ignored. A daily action's body is `ActionRequestSchema`, the same as a
// match's.
export const DailyStartRequestSchema = z.object({}).strict();
export const DailyFinishRequestSchema = z.object({}).strict();

// Consumed by `DailyPage` / lazily-loaded daily game UI components. The page
// queues whatever `send` is given and posts it in order, so a game UI may
// call it as fast as its player acts.
export interface DailyUiProps {
  view: unknown;
  status: DailyRunStatus;
  send: (action: unknown) => void;
}

// Consumed by `MatchPage` / lazily-loaded per-game UI components
// (declared here rather than in games/registry.ts because it depends on
// `Result` and the other cross-boundary types already living in this file).
export interface GameUiProps {
  view: unknown;
  me: PlayerId;
  players: PlayerInfo[];
  waitingOn: PlayerId[];
  deadline: number | null;
  result: Result | null;
  send: (action: unknown) => void;
}
