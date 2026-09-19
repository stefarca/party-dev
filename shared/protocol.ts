import { z } from "zod";

import type { ActionDescription, Result } from "./game";
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

export const CreateMatchRequestSchema = z.object({
  gameId: z.string().min(1, "gameId is required"),
});
export type CreateMatchRequest = z.infer<typeof CreateMatchRequestSchema>;

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
  | { type: "player_joined"; id: PlayerId; nickname: string }
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
