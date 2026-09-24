-- Every stretch of time a match spent waiting on one player: it opens when the
-- player joins the match's `waitingOn` and closes when they leave it, whether
-- by their own move (`moved` = 1) or because a deadline or the end of the match
-- took them out of it (`moved` = 0). It is what the wall of shame adds up, and
-- a closed row with `moved` = 1 is a move made on the day it closed, which is
-- what a play streak counts.
--
-- Derived, like the rest of the match index: each MatchDO keeps the same ledger
-- in its own storage and writes its rows here from `writeIndexNow()`, a closed
-- row until one write of it lands and an open row on every write. A row is the
-- same wait on both sides because the key is the wait's own start, never a
-- counter only one side knows.
--
-- Additive, and nothing older than this migration reads or writes these tables,
-- so the Worker still serving while it runs never notices them.
CREATE TABLE IF NOT EXISTS turn_waits (
  match_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,            -- NULL while the match is still waiting on them
  moved INTEGER,               -- 1 = their own move ended it; NULL while open
  PRIMARY KEY (match_id, player_id, started_at)
);

-- A player's own waits, for their play streak and their reply times.
CREATE INDEX IF NOT EXISTS idx_turn_waits_player ON turn_waits(player_id, ended_at);
-- Every wait that overlaps a week, for the wall of shame and the recap. Open
-- waits are the NULLs at the front of it.
CREATE INDEX IF NOT EXISTS idx_turn_waits_ended ON turn_waits(ended_at);

-- A player's daily runs, for their play streak. The primary key leads with the
-- game, so it cannot answer "which days did this player play".
CREATE INDEX IF NOT EXISTS idx_daily_runs_player ON daily_runs(player_id, day);

-- The weekly recaps already posted, one row per week, keyed by the first day
-- it covers. Claiming the row before posting is what stops a second run of the
-- same cron, or a manual one, from posting the same week twice.
CREATE TABLE IF NOT EXISTS recaps (
  week TEXT PRIMARY KEY,       -- YYYY-MM-DD, a UTC day (shared/daily.ts)
  sent_at INTEGER NOT NULL
);

-- The waits already under way when this runs, so a match that has been stuck
-- for a week is on the wall of shame from the first recap. Each starts at the
-- match's last update, when the index last marked the player waiting; the
-- Durable Object takes a wait it has no row for to start at that same moment,
-- so the first write it makes after this lands on the same row and closes it.
INSERT OR IGNORE INTO turn_waits (match_id, player_id, started_at, ended_at, moved)
SELECT mp.match_id, mp.player_id, m.updated_at, NULL, NULL
FROM match_players mp
JOIN matches m ON m.id = mp.match_id
WHERE m.status = 'active' AND mp.waiting = 1 AND m.updated_at IS NOT NULL;
