-- Web push subscriptions: one row per browser that opted in, keyed by the
-- endpoint its push service handed out. Authoritative, like `players`, and
-- for the same reason: a subscription is a capability a browser granted
-- once, and nothing in the Durable Objects or the match index can rebuild
-- it. Losing a row costs that device its nudges until someone opts in again.
--
-- The endpoint is the primary key rather than (player_id, endpoint): a
-- browser has exactly one subscription per origin, whoever happens to be
-- signed in on it, so signing in as someone else moves the row instead of
-- leaving the previous player being notified about a device they no longer
-- hold.
--
-- Additive, and nothing older than this migration reads or writes the table,
-- so the Worker still serving while it runs never notices it.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  p256dh TEXT NOT NULL,        -- the browser's public key, base64url
  auth TEXT NOT NULL,          -- the shared auth secret, base64url
  language TEXT,               -- the app language this device wants to be notified in
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

-- Every send begins with "which devices does this player have", and that is
-- the only question this table is ever asked.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_player ON push_subscriptions(player_id);
