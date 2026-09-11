import { z } from "zod";

import type { Result } from "./game";

// The single home for cross-boundary types and zod schemas (PLAN.md §9).
// PLAN.md §5 rule 1 is binding here: every inbound payload — REST bodies
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
const NO_CONTROL_CHARS = /^[^\x00-\x1F\x7F]*$/;

export const IdentityRequestSchema = z.object({
  nickname: z
    .string()
    .trim()
    .min(1, "nickname is required")
    .max(24, "nickname must be 24 characters or fewer")
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

// ---------------------------------------------------------------------------
// Live match wire protocol (PLAN.md §5, §7). Used by both the WebSocket at
// `/ws/:id` and the HTTP fallbacks (`GET /api/matches/:id/snapshot`,
// `POST /api/matches/:id/actions`) — §7 is binding: "treat WS as an
// optimization over 'fetch state on load', never as the only path", so both
// transports must speak the exact same message/snapshot shapes.
// ---------------------------------------------------------------------------

// Client -> server. Every one of these is zod-validated by MatchDO before
// it is trusted (§5 rule 1) — the client sends *intents*, never state.
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
export interface MatchEvent {
  seq: number;
  ts: number;
  payload: unknown;
}

// The shape shared by the WS `snapshot` message and the HTTP snapshot
// route's JSON body (§7). `view` is always this player's own `view()`
// projection (or `null` before the game has started) — never raw state
// (§5 rule 2).
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

export interface ErrorMessage {
  t: "error";
  code: string;
  message: string;
}

export interface PongMessage {
  t: "pong";
}

export type ServerMessage = SnapshotMessage | EventsMessage | ErrorMessage | PongMessage;

// Consumed by plan 05's `MatchPage` / lazily-loaded per-game UI components
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
