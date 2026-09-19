-- A match refers to its players by id, never by name. Names live in one
-- place, `players`, and every roster is named from it when it is read: the
-- hub by joining `players`, a Durable Object by looking its players up
-- before it sends a snapshot. So a rename reaches every match at once, and
-- nothing holds a copy of a name that can go stale.
--
-- Unlike the migrations before it, this one is not additive: a Worker
-- older than it still reads and writes this column, and fails doing so
-- until the new Worker is live.
ALTER TABLE match_players DROP COLUMN nickname;
