-- Keeping a nickname to its owner, without asking anyone to register.
--
-- A nickname nobody holds is still claimed by typing it. A taken one no longer
-- signs a new device straight in when the player has a device that can answer:
-- that device is asked to approve it first. A player can also lock their name
-- with a PIN or a passkey, and every device can sign all the others out.
--
-- Every change is additive. The Worker still serving while this runs names its
-- columns on every read and insert, so it never sees the new ones, and the
-- defaults below are what a row it inserts gets.

-- Bumped by "sign out everywhere". A session cookie carries the epoch it was
-- issued under, and one from an older epoch is no longer a session.
ALTER TABLE players ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0;

-- The PIN, as an HMAC under a key derived from SESSION_SECRET with a salt of
-- its own. NULL when the player has none.
ALTER TABLE players ADD COLUMN pin_hash TEXT;
ALTER TABLE players ADD COLUMN pin_salt TEXT;
-- Wrong PINs in a row, and the moment the next guess is taken again after too
-- many of them.
ALTER TABLE players ADD COLUMN pin_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN pin_blocked_until INTEGER;

-- The first time the player locked their name. Never cleared, even when the
-- lock is taken off again: the achievement for locking reads it, and an
-- achievement once earned is never lost.
ALTER TABLE players ADD COLUMN locked_at INTEGER;

-- The passkeys a player can sign in with. Authoritative like `players`: a
-- credential's public key exists nowhere else.
CREATE TABLE IF NOT EXISTS passkeys (
  credential_id TEXT PRIMARY KEY,   -- base64url, as the authenticator names it
  player_id TEXT NOT NULL,
  public_key TEXT NOT NULL,         -- COSE public key, base64url
  counter INTEGER NOT NULL,         -- the authenticator's signature counter
  transports TEXT,                  -- JSON array of transport hints, or NULL
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_passkeys_player ON passkeys(player_id);

-- Every sign-in to a nickname somebody already held, and every one still
-- waiting for the owner's approval. The owner's devices list the ones they
-- have not acknowledged, so a sign-in on someone else's phone never goes
-- unnoticed.
--
--   status: pending   waiting on the owner (or, with `auto_at`, on the clock)
--           approved  the owner allowed it; the new device has yet to collect
--           denied    the owner turned it down
--           completed a session was issued for it
--   method: approved | auto | open | pin | passkey — how it got through
CREATE TABLE IF NOT EXISTS sign_ins (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  secret_hash TEXT,                 -- SHA-256 of the requesting device's secret, while one waits
  device TEXT NOT NULL,             -- e.g. "Chrome on Android", from the User-Agent
  status TEXT NOT NULL,
  method TEXT,
  created_at INTEGER NOT NULL,
  auto_at INTEGER,                  -- when a pending one goes through by itself, if it ever does
  expires_at INTEGER NOT NULL,      -- when a pending or approved one stops being collectable
  completed_at INTEGER,
  acknowledged_at INTEGER           -- when the owner said it was them, or signed everyone out
);
CREATE INDEX IF NOT EXISTS idx_sign_ins_player ON sign_ins(player_id, created_at);
