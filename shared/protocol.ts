import { z } from "zod";

// The single home for cross-boundary types and zod schemas (PLAN.md §9).
// PLAN.md §5 rule 1 is binding here: every inbound payload — REST bodies
// included, not just future WS messages — is validated with a schema from
// this file, never trusted as-is.

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
