// The hourly sweep, run by the cron trigger in wrangler.jsonc. A lobby
// expires, and a turn times out, through its match's own Durable Object
// alarm (see `alarm()` in worker/match.ts), but only in a match that has one,
// and a match nobody visits never wakes to set it. Two kinds go without: a
// lobby created before lobbies expired, and a match started before its game
// timed the opening turn, still waiting on that turn. The sweep reaches them
// through the match index, the only list of matches there is: lobbies older
// than a day, and matches under way that have not moved in a day, which a
// match with a turn clock never goes without. It asks each one's DO to arm
// its alarm. It also drops index rows whose DO holds no match, which is what
// is left behind when the index delete in `dissolveLobby()` failed.
//
// Nothing here may throw out of `sweepMatches()`: one match failing must not
// stop the rest, and the next run picks up whatever this one missed.

// A lobby younger than this has had its alarm since it was created, and a
// match under way that moved more recently than this has a turn clock running.
export const SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000;
// Matches per run. Every one is a request to a Durable Object, and a Worker
// invocation is allowed only so many subrequests; the oldest go first, and
// whatever is left over waits for the next run.
export const SWEEP_BATCH = 20;

export interface SweepReport {
  armed: number;
  orphaned: number;
  failed: number;
}

export async function sweepMatches(env: Env, now = Date.now()): Promise<SweepReport> {
  const report: SweepReport = { armed: 0, orphaned: 0, failed: 0 };

  let ids: string[];
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, CASE status WHEN 'lobby' THEN created_at ELSE updated_at END AS since
         FROM matches
        WHERE (status = 'lobby' AND created_at < ?1)
           OR (status = 'active' AND updated_at < ?1)
        ORDER BY since
        LIMIT ?2`,
    )
      .bind(now - SWEEP_MIN_AGE_MS, SWEEP_BATCH)
      .all<{ id: string }>();
    ids = results.map((row) => row.id);
  } catch (err) {
    console.error("sweepMatches: match lookup failed", err);
    return report;
  }

  for (const id of ids) {
    try {
      const stub = env.MATCH.get(env.MATCH.idFromName(id));
      const res = await stub.fetch("http://do/sweep", { method: "POST" });
      if (res.status === 404) {
        await env.DB.prepare("DELETE FROM match_players WHERE match_id = ?").bind(id).run();
        await env.DB.prepare("DELETE FROM matches WHERE id = ?").bind(id).run();
        report.orphaned++;
      } else if (res.ok) {
        report.armed++;
      } else {
        report.failed++;
        console.error("sweepMatches: sweep refused", { matchId: id, status: res.status });
      }
    } catch (err) {
      report.failed++;
      console.error("sweepMatches: sweep failed", { matchId: id, err });
    }
  }

  console.log("sweepMatches", report);
  return report;
}
