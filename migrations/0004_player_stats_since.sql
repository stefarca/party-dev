-- Resetting a record deletes nothing. The match index keeps every row, so the
-- hub still lists every match; the registry only remembers the moment the
-- record counts from, and the record skips matches created before it.
-- NULL means the player never reset, and every match counts.
--
-- Nullable and additive, so the Worker still serving while this runs (it
-- names its columns on every read and insert) never notices it.
ALTER TABLE players ADD COLUMN stats_since INTEGER;
