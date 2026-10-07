-- Which achievement levels each player has already been told they reached,
-- one row per player per achievement they have been told about. What a
-- player has earned is not stored anywhere: worker/achievements.ts works it
-- out from the match index on every read, like the stats. Only this is
-- remembered, so that "achievement unlocked" is said once per player, on
-- whichever of their devices sees it first, and never again.
--
-- Authoritative, in the way `players` is: nothing can rebuild it. Losing a
-- row costs no more than hearing about that achievement a second time.
--
-- Additive, and nothing older than this migration reads or writes the table,
-- so the Worker still serving while it runs never notices it.
CREATE TABLE IF NOT EXISTS achievements_seen (
  player_id TEXT NOT NULL,
  achievement_id TEXT NOT NULL,     -- an id from shared/achievements.ts
  level INTEGER NOT NULL,           -- how many of its tiers the player has been told about
  PRIMARY KEY (player_id, achievement_id)
);
