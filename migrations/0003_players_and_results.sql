-- The player registry. This is the one authoritative table in D1: a
-- nickname IS the account, so `nickname_key` (shared/nickname.ts) must be
-- unique across the whole app or the same name on a second device would
-- sign in as a different person. Everything else here stays derived from
-- the Durable Objects and can be rebuilt; these rows cannot.
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,            -- the stable playerId carried in the session cookie
  nickname TEXT NOT NULL,         -- as the player spelled it, for display
  nickname_key TEXT NOT NULL,     -- folded form; what "the same nickname" means
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
-- The uniqueness that makes the claim atomic: two devices racing to take
-- the same name both INSERT, one gets a constraint error and re-reads the
-- winner's row instead of minting a second identity.
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_nickname_key ON players(nickname_key);

-- Backfill every player already known from the match index, so their
-- nickname is reserved for them before anyone new can claim it. OR IGNORE
-- because two pre-registry players could have picked the same nickname on
-- different devices — the earliest-joined one keeps it, and the other is
-- treated as a signed-out visitor on their next load. (A session this
-- misses entirely, because it never played a match, is registered under its
-- own nickname by GET /api/me the next time it loads.)
-- `lower(trim(...))` is SQL's closest reach for shared/nickname.ts's fold
-- (SQLite has no NFKC and no regex): it agrees for every nickname that is
-- not padded with doubled whitespace or written in compatibility
-- characters, and a backfilled row that disagrees only costs that player
-- their history the first time they sign in somewhere new.
INSERT OR IGNORE INTO players (id, nickname, nickname_key, created_at, last_seen_at)
SELECT mp.player_id,
       mp.nickname,
       lower(trim(mp.nickname)),
       COALESCE(MIN(m.created_at), 0),
       COALESCE(MAX(m.updated_at), 0)
FROM match_players mp
JOIN matches m ON m.id = mp.match_id
WHERE mp.nickname IS NOT NULL AND trim(mp.nickname) <> ''
GROUP BY mp.player_id
ORDER BY MIN(m.created_at);

-- Two denormalized columns so the hub can show a player's record without
-- waking one Durable Object per match. Derived like the rest of the index:
-- MatchDO.writeIndexNow() recomputes both from `result()` on every commit.
-- Matches that finished before this shipped are never committed again, so
-- they stay NULL: they count as played and finished, but not as won.
ALTER TABLE matches ADD COLUMN result_kind TEXT;      -- win | draw | scores | NULL while unfinished
ALTER TABLE match_players ADD COLUMN won INTEGER;     -- 1 = this player is among the winners
