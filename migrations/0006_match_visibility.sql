-- Whether a lobby is listed on every player's hub for anyone to join. Derived
-- like the rest of the index: MatchDO.writeIndexNow() writes it from the match
-- record on every commit. NULL is every match indexed before this shipped, and
-- reads as private, which is what all of them were.
--
-- Nullable and additive, so the Worker still serving while this runs (it
-- names its columns on every read and insert) never notices it.
ALTER TABLE matches ADD COLUMN visibility TEXT;   -- private | public | NULL

-- The hub's public list asks for exactly these rows, newest first, on every
-- load. Partial, so it stays as small as the handful of open lobbies rather
-- than growing with every match ever played.
CREATE INDEX IF NOT EXISTS idx_matches_public_lobbies ON matches(updated_at)
  WHERE status = 'lobby' AND visibility = 'public';
