CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY, game_id TEXT, status TEXT,   -- lobby|active|done
  created_at INTEGER, updated_at INTEGER, deadline INTEGER
);
CREATE TABLE IF NOT EXISTS match_players (
  match_id TEXT, player_id TEXT, waiting INTEGER,   -- 1 = it is on them
  PRIMARY KEY (match_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_waiting ON match_players(player_id, waiting);
