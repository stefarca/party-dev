-- The daily games' chart: one row per player per daily game per day. Derived,
-- like the match index: each run lives in a DailyDO of its own, which is the
-- authority on it, and writes its row here twice — when the run starts and
-- when it ends. Nothing reads a run's state from here; the chart and the hub
-- are all that do.
--
-- `day` is the run's UTC date (shared/daily.ts). `score` is what the chart
-- ranks by, and the game says which way (`DailyGameMeta.order`); it is NULL
-- while the run is going, and for a run that ended without a rankable score.
-- `detail` is the game's own line for the chart, JSON of a `{ key, values }`
-- in the game's i18n namespace.
--
-- Additive, and nothing older than this migration reads or writes the table,
-- so the Worker still serving while it runs never notices it.
CREATE TABLE IF NOT EXISTS daily_runs (
  game_id TEXT NOT NULL,
  day TEXT NOT NULL,
  player_id TEXT NOT NULL,
  status TEXT NOT NULL,        -- active | done
  score REAL,
  detail TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  PRIMARY KEY (game_id, day, player_id)
);
