-- The dashboard (plan 03) must render opponents' names and the host badge
-- from a single index query (§6), and D1 is display-only derived state —
-- MatchDO remains the authority for both fields. These two columns let the
-- index carry enough denormalized data for that one query, instead of
-- forcing a per-match round-trip into the Durable Object to read names.
ALTER TABLE matches ADD COLUMN host_id TEXT;
ALTER TABLE match_players ADD COLUMN nickname TEXT;
