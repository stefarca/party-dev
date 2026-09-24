import { displayNickname, nicknameKey } from "../shared/nickname";
import type { PlayerStats } from "../shared/protocol";

export type { PlayerStats };

// The player registry: the nickname *is* the account. Typing the same one
// on a second device signs in as the same player and finds the same
// matches, which is only true if one nickname can ever belong to one
// player — so the `players.nickname_key` unique index, not any check in
// this file, is what actually enforces it. Every write here is written to
// lose that race gracefully.
//
// This is the one part of D1 the app cannot rebuild from the Durable
// Objects: a match index can be replayed, an identity cannot. Match truth
// still never comes from here.
//
// There is no password. Whoever types a nickname first owns it, and
// whoever types it afterwards is treated as them — the same trust model the
// app had when a nickname was just a label, now with a memory.

export interface PlayerRecord {
  id: string;
  nickname: string;
}

// Thrown when a nickname belongs to a different player. Callers turn it
// into a 409 — it is the one outcome the player can act on (pick another
// name, or sign out and sign in as that one).
export class NicknameTakenError extends Error {
  constructor() {
    super("nickname already belongs to another player");
    this.name = "NicknameTakenError";
  }
}

interface PlayerRow {
  id: string;
  nickname: string;
}

function findByKey(db: D1Database, key: string): Promise<PlayerRow | null> {
  return db
    .prepare("SELECT id, nickname FROM players WHERE nickname_key = ?")
    .bind(key)
    .first<PlayerRow>();
}

export function findPlayerById(db: D1Database, id: string): Promise<PlayerRecord | null> {
  return db.prepare("SELECT id, nickname FROM players WHERE id = ?").bind(id).first<PlayerRecord>();
}

// Signs in under `nickname`: returns the player who already holds it, or
// mints one if nobody does. Never throws `NicknameTakenError` — for a
// caller with no session, an already-claimed nickname is the whole point.
export async function signIn(db: D1Database, nickname: string): Promise<PlayerRecord> {
  const key = nicknameKey(nickname);
  const display = displayNickname(nickname);
  const now = Date.now();

  const existing = await findByKey(db, key);
  if (existing) {
    // The registry keeps whatever spelling was used most recently: it is
    // the same account either way, and a player who capitalises their name
    // differently today meant to.
    await db
      .prepare("UPDATE players SET nickname = ?, last_seen_at = ? WHERE id = ?")
      .bind(display, now, existing.id)
      .run();
    return { id: existing.id, nickname: display };
  }

  const id = crypto.randomUUID();
  try {
    await db
      .prepare(
        "INSERT INTO players (id, nickname, nickname_key, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(id, display, key, now, now)
      .run();
    return { id, nickname: display };
  } catch {
    // Two devices claimed the same new nickname at once and the unique
    // index turned one of them away. The winner's row is the answer — the
    // loser must not mint a second player under the same name.
    const winner = await findByKey(db, key);
    if (!winner) throw new Error(`nickname "${key}" could not be claimed or read back`);
    return { id: winner.id, nickname: winner.nickname };
  }
}

// Moves an existing player onto `nickname`, keeping their id (and therefore
// every match they are in). The old nickname is released by the same write,
// so it is free for someone else immediately.
export async function renamePlayer(
  db: D1Database,
  playerId: string,
  nickname: string,
): Promise<PlayerRecord> {
  const key = nicknameKey(nickname);
  const display = displayNickname(nickname);
  const now = Date.now();

  const holder = await findByKey(db, key);
  if (holder && holder.id !== playerId) throw new NicknameTakenError();

  try {
    const result = await db
      .prepare("UPDATE players SET nickname = ?, nickname_key = ?, last_seen_at = ? WHERE id = ?")
      .bind(display, key, now, playerId)
      .run();
    if (result.meta.changes > 0) return { id: playerId, nickname: display };
  } catch {
    // Someone claimed the nickname between the check above and this write.
    throw new NicknameTakenError();
  }

  // No row to update: a session minted before the registry existed, or one
  // whose backfill lost a nickname collision. Give that player id a row now
  // rather than sending them back to the gate to mint a second identity.
  try {
    await db
      .prepare(
        "INSERT INTO players (id, nickname, nickname_key, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(playerId, display, key, now, now)
      .run();
    return { id: playerId, nickname: display };
  } catch {
    throw new NicknameTakenError();
  }
}

// A player's record, straight off the match index. Derived and cheap to
// rebuild — `won` and `result_kind` are written by MatchDO.writeIndexNow()
// on every commit, so this never has to wake a Durable Object.
//
// After a reset it counts only matches created at or after `stats_since`.
// A match already under way at the reset stays out of the record even once
// it finishes; otherwise a reset would not start at zero.
export async function playerStats(db: D1Database, playerId: string): Promise<PlayerStats> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS played,
              COALESCE(SUM(CASE WHEN m.status = 'done' THEN 1 ELSE 0 END), 0) AS finished,
              COALESCE(SUM(CASE WHEN m.status = 'done' AND mp.won = 1 THEN 1 ELSE 0 END), 0) AS won,
              (SELECT stats_since FROM players WHERE id = ?) AS since
       FROM match_players mp
       JOIN matches m ON m.id = mp.match_id
       LEFT JOIN players p ON p.id = mp.player_id
       WHERE mp.player_id = ?
         AND (p.stats_since IS NULL OR m.created_at >= p.stats_since)`,
    )
    .bind(playerId, playerId)
    .first<PlayerStats>();
  return row ?? { played: 0, finished: 0, won: 0, since: null };
}

// Starts the player's record over from now. Deletes nothing: every match
// stays in the index and on the hub, and a later change could count them
// all again just by clearing `stats_since`. False when the registry has no
// row for this player.
export async function resetStats(db: D1Database, playerId: string): Promise<boolean> {
  const result = await db
    .prepare("UPDATE players SET stats_since = ? WHERE id = ?")
    .bind(Date.now(), playerId)
    .run();
  return result.meta.changes > 0;
}
