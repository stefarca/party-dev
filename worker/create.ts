import { generateMatchCode } from "../shared/ids";
import type { MatchVisibility, PlayerId } from "../shared/protocol";

// Opens a new lobby: the one path behind both POST /api/matches and a
// rematch (`MatchDO`, on the finished match's behalf), so a code is claimed
// the same way whoever asks.
//
// The INSERT is only a collision reservation on the code, not the
// authoritative index write — `MatchDO.syncIndex()` (called via
// /lobby/create below) is what writes the real matches/match_players rows
// once the DO has accepted the match (D1 is derived, the DO is
// authoritative). It retries on a PRIMARY KEY collision, capped at 5
// attempts (32^6 codes makes repeated collisions vanishingly unlikely).
export async function createMatch(
  env: Env,
  { gameId, hostId, visibility }: { gameId: string; hostId: PlayerId; visibility: MatchVisibility },
): Promise<{ ok: true; matchId: string } | { ok: false; error: string }> {
  const now = Date.now();
  let matchId: string | null = null;
  for (let attempt = 0; attempt < 5 && !matchId; attempt++) {
    const code = generateMatchCode();
    try {
      await env.DB.prepare(
        "INSERT INTO matches (id, game_id, status, created_at, updated_at, deadline) VALUES (?, ?, 'lobby', ?, ?, NULL)",
      )
        .bind(code, gameId, now, now)
        .run();
      matchId = code;
    } catch {
      // Assume a PRIMARY KEY collision on `id` and retry with a new code.
    }
  }
  if (!matchId) return { ok: false, error: "code_exhausted" };

  try {
    const stub = env.MATCH.get(env.MATCH.idFromName(matchId));
    const res = await stub.fetch("http://do/lobby/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matchId, gameId, hostId, visibility }),
    });
    if (!res.ok) throw new Error(`lobby create failed with status ${res.status}`);
  } catch (err) {
    // The DO create failed after the code was reserved in D1 — delete the
    // reservation so the code is not left as an orphan row.
    try {
      await env.DB.prepare("DELETE FROM matches WHERE id = ?").bind(matchId).run();
    } catch (deleteErr) {
      console.error("releasing a match code failed", { matchId, deleteErr });
    }
    console.error("match create failed", err);
    return { ok: false, error: "create_failed" };
  }

  return { ok: true, matchId };
}
