import type { TFunction } from "i18next";

import { ApiError } from "./api";

// The error codes a player can run into that have a sentence of their own under `errors.*`: the
// server's (worker/api.ts, worker/match.ts, worker/daily.ts) plus the fallback codes useMatch reports. Anything
// else gets the caller's own fallback. That includes codes that only a bug could produce, and a
// browser's "Failed to fetch".
const DESCRIBED_CODES = [
  "action_failed",
  "already_started",
  "day_over",
  "game_unavailable",
  "invalid_action",
  "invalid_move",
  "lobby_full",
  "nickname_taken",
  "no_identity",
  "no_run",
  "not_a_player",
  "not_active",
  "not_found",
  "not_host",
  "not_joinable",
  "not_today",
  "not_your_turn",
  "run_over",
  "snapshot_failed",
  "start_failed",
  "unknown_game",
  "wrong_player_count",
] as const;

type DescribedCode = (typeof DESCRIBED_CODES)[number];

function describedCode(err: unknown): DescribedCode | null {
  let code: unknown = null;
  if (err instanceof ApiError) code = err.code;
  else if (typeof err === "object" && err !== null && "code" in err) code = err.code;
  return typeof code === "string" && (DESCRIBED_CODES as readonly string[]).includes(code)
    ? (code as DescribedCode)
    : null;
}

// What to tell the player about a failure `err`, an `ApiError` or a useMatch `MatchError`. The
// server's messages are English and meant for logs, so they are never shown as they are.
// `fallback` says what the player was trying to do.
export function errorText(t: TFunction, err: unknown, fallback: string): string {
  const code = describedCode(err);
  return code ? t(`errors.${code}`) : fallback;
}
