import type { PlayerId } from "../shared/protocol";

// Slack incoming-webhook nudges. Deliberately minimal:
// one `fetch()` to a secret URL with Slack's plain `text` payload — no Block
// Kit, no retries. A nudge is always best-effort: nothing in this file may
// ever throw out of `sendSlackNudge`, because it is fired from
// `MatchDO.sendNudges()` via `ctx.waitUntil()`, and a throw reaching `alarm()`
// would be retried up to 6 times.

// The floor under a nudge nobody answered (see `shouldNudge` below), on top
// of the primary per-turn rule enforced in `worker/match.ts`.
export const MIN_NUDGE_INTERVAL_MS = 10 * 60 * 1000;

export interface NudgePlayer {
  id: PlayerId;
  nickname: string;
}

// What a nudge is about. "turn": the game is waiting on these players.
// "lobbyFull": their lobby has filled every seat, and only the host (who is
// the one player it is ever sent to) can start the match. "lobbyExpiring":
// their lobby, which only the host can start, is deleted in an hour.
export type NudgeKind = "turn" | "lobbyFull" | "lobbyExpiring";

export interface NudgeParams {
  matchId: string;
  gameName: string;
  players: NudgePlayer[];
  url: string;
  kind?: NudgeKind; // "turn" when absent
}

// One message regardless of how many players just became waited-on at once
// (a trivia round start must be a single Slack message, never N) — the
// caller is responsible for batching every eligible player into one call.
function composeMessage({ gameName, players, url, kind = "turn" }: NudgeParams): string {
  const names = players.map((p) => p.nickname).join(", ");
  if (kind === "lobbyFull") return `${names} can start ${gameName}, the lobby is full: ${url}`;
  if (kind === "lobbyExpiring") {
    return `${names}'s ${gameName} lobby closes in an hour unless it is started: ${url}`;
  }
  const verb = players.length === 1 ? "is" : "are";
  return `${names} ${verb} up in ${gameName}: ${url}`;
}

// Never throws. Every failure mode below (missing secret, network error,
// non-2xx response) is swallowed after a single log line — see the file
// comment above for why.
export async function sendSlackNudge(env: Env, params: NudgeParams): Promise<void> {
  if (params.players.length === 0) return;

  const webhookUrl = env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    // Local dev and any contributor without the secret must still work —
    // this is a no-op, not an error.
    console.log("SLACK_WEBHOOK_URL not set; skipping nudge", {
      matchId: params.matchId,
      players: params.players.map((p) => p.id),
    });
    return;
  }

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: composeMessage(params) }),
      // A hung Slack request must not hold the calling Durable Object alive
      // indefinitely via ctx.waitUntil().
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.error("sendSlackNudge failed", err);
  }
}

// The rate-limit decision, extracted as a pure function so it is
// unit-testable without a Durable Object (worker/nudge.test.ts).
//
// `nudgedAt` is this player's own entry from the persisted
// `MatchRecord.nudgedAt` map — the epoch ms they were last nudged, or
// `undefined` if they never were or have moved since (`MatchDO` drops the
// entry when a player acts). `becameWaitingAt` is when they most recently
// transitioned into `waitingOn` — in practice this is always the same
// instant as `now`, because `MatchDO.nudgeHook` only ever calls this for
// players in that commit's own `newlyWaiting` list, but it is kept as its
// own parameter (rather than folded into `now`) so the two rules below can
// be exercised independently in tests.
//
// Two rules:
// 1. One nudge per player per match per turn: eligible once `nudgedAt`
//    predates `becameWaitingAt` — i.e. nothing has nudged them since this
//    waiting spell began.
// 2. A floor for a nudge nobody answered: a player who has not moved since
//    their last nudge is not nudged again sooner than `MIN_NUDGE_INTERVAL_MS`
//    after it, however often `waitingOn` takes them in and out meanwhile
//    (a simultaneous game's rounds going by without them, say). A player who
//    is actually playing never meets it — their move cleared the entry — so
//    they hear about every turn, however quickly it comes back to them.
export function shouldNudge(
  nudgedAt: number | undefined,
  _playerId: PlayerId,
  now: number,
  becameWaitingAt: number,
): boolean {
  if (nudgedAt === undefined) return true;
  if (nudgedAt >= becameWaitingAt) return false;
  return now - nudgedAt >= MIN_NUDGE_INTERVAL_MS;
}
