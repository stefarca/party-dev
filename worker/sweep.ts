// The hourly lobby sweep, run by the cron trigger in wrangler.jsonc. A lobby
// expires through its own Durable Object alarm (see `lobbyAlarm()` in
// worker/match.ts), but only a lobby that has one: nothing sets it on a lobby
// created before lobbies expired until something happens in it, and a lobby
// nobody visits never wakes. The sweep reaches those through the match index,
// the only list of lobbies there is, and asks each one's DO to arm its alarm.
// It also drops index rows whose DO holds no match, which is what is left
// behind when the index delete in `dissolveLobby()` failed.
//
// Nothing here may throw out of `sweepLobbies()`: one lobby failing must not
// stop the rest, and the next run picks up whatever this one missed.

// A lobby younger than this has had its alarm since it was created.
export const SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000;
// Lobbies per run. Every one is a request to a Durable Object, and a Worker
// invocation is allowed only so many subrequests; the oldest go first, and
// whatever is left over waits for the next run.
export const SWEEP_BATCH = 20;

export interface SweepReport {
  armed: number;
  orphaned: number;
  failed: number;
}

export async function sweepLobbies(env: Env, now = Date.now()): Promise<SweepReport> {
  const report: SweepReport = { armed: 0, orphaned: 0, failed: 0 };

  let ids: string[];
  try {
    const { results } = await env.DB.prepare(
      `SELECT id FROM matches
        WHERE status = 'lobby' AND created_at < ?
        ORDER BY created_at
        LIMIT ?`,
    )
      .bind(now - SWEEP_MIN_AGE_MS, SWEEP_BATCH)
      .all<{ id: string }>();
    ids = results.map((row) => row.id);
  } catch (err) {
    console.error("sweepLobbies: lobby lookup failed", err);
    return report;
  }

  for (const id of ids) {
    try {
      const stub = env.MATCH.get(env.MATCH.idFromName(id));
      const res = await stub.fetch("http://do/lobby/sweep", { method: "POST" });
      if (res.status === 404) {
        await env.DB.prepare("DELETE FROM match_players WHERE match_id = ?").bind(id).run();
        await env.DB.prepare("DELETE FROM matches WHERE id = ?").bind(id).run();
        report.orphaned++;
      } else if (res.ok) {
        report.armed++;
      } else {
        report.failed++;
        console.error("sweepLobbies: sweep refused", { matchId: id, status: res.status });
      }
    } catch (err) {
      report.failed++;
      console.error("sweepLobbies: sweep failed", { matchId: id, err });
    }
  }

  console.log("sweepLobbies", report);
  return report;
}
