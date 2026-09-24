import { addDays, dayOf } from "../shared/daily";
import { UNKNOWN_NICKNAME } from "../shared/nickname";
import type {
  ChampionEntry,
  GameRecord,
  HeadToHead,
  Leaderboard,
  PlayStreak,
  PlayerId,
  PlayerStatsDetail,
  PlayerStreaks,
  Rival,
  ShameEntry,
  Streak,
} from "../shared/protocol";
import { playerStats } from "./players";

// Every stat the app shows beyond the hub's three numbers: a player's record
// game by game, their streaks and rivalries, and the week's boards. All of it
// is read from the derived index — `matches`/`match_players` for results,
// `turn_waits` for how long matches waited on whom, `daily_runs` for the
// daily games — so it can lag a match by a commit, and never wakes a Durable
// Object. Names come from the player registry as they are read.
//
// Two rules decide what counts. A player's record — wins, win streaks,
// rivalries, the per-game lines — is theirs to reset, and counts only matches
// created since `players.stats_since`, like the hub's. What happened in a
// given week — the champions, the wall of shame — is not a record: it counts
// every match in that week, whoever has reset since. Neither kind counts a
// finished match whose `result_kind` is NULL, which finished before the index
// recorded who won it.

const DAY_MS = 24 * 60 * 60 * 1000;

// How far back a player's typical reply time looks.
export const REPLY_WINDOW_DAYS = 30;
// The boards' window, and how many players each lists.
export const LEADERBOARD_WINDOW_MS = 7 * DAY_MS;
export const BOARD_LIMIT = 10;
// How many opponents a player's rivalries list.
export const RIVAL_LIMIT = 20;

// ---------------------------------------------------------------------------
// Streaks, as pure functions of what the queries below read.
// ---------------------------------------------------------------------------

// A play streak from the days a player did something, in any order and with
// repeats. The current streak runs back from today, or from yesterday while
// today is still going — a player who played every day up to yesterday has
// not lost their streak, they just have not kept it yet.
export function playStreak(days: Iterable<string>, today: string): PlayStreak {
  const played = new Set(days);
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of [...played].sort()) {
    run = previous !== null && addDays(previous, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  const playedToday = played.has(today);
  let current = 0;
  for (
    let day = playedToday ? today : addDays(today, -1);
    played.has(day);
    day = addDays(day, -1)
  ) {
    current++;
  }
  return { current, best, today: playedToday };
}

// A win streak from a player's finished matches, oldest first: true for each
// one they won.
export function winStreak(results: Iterable<boolean>): Streak {
  let best = 0;
  let run = 0;
  for (const won of results) {
    run = won ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { current: run, best };
}

// The middle value of `values`, which must be sorted; the mean of the middle
// two for an even count.
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 1 ? values[mid] : Math.round((values[mid - 1] + values[mid]) / 2);
}

// ---------------------------------------------------------------------------
// One player.
// ---------------------------------------------------------------------------

// The UTC day a `turn_waits` timestamp falls on, the same one `dayOf()` gives.
const WAIT_DAY = "strftime('%Y-%m-%d', w.ended_at / 1000, 'unixepoch')";

// Only a player's own finished matches, known results, since their reset.
const RECORD_FILTER = `m.status = 'done' AND m.result_kind IS NOT NULL
  AND (p.stats_since IS NULL OR m.created_at >= p.stats_since)`;

export async function playerStreaks(
  db: D1Database,
  playerId: PlayerId,
  now: number,
): Promise<PlayerStreaks> {
  const [days, results] = await Promise.all([
    db
      .prepare(
        `SELECT ${WAIT_DAY} AS day FROM turn_waits w
         WHERE w.player_id = ?1 AND w.moved = 1 AND w.ended_at IS NOT NULL
         UNION
         SELECT day FROM daily_runs WHERE player_id = ?1`,
      )
      .bind(playerId)
      .all<{ day: string }>(),
    db
      .prepare(
        `SELECT COALESCE(mp.won, 0) AS won
         FROM match_players mp
         JOIN matches m ON m.id = mp.match_id
         LEFT JOIN players p ON p.id = mp.player_id
         WHERE mp.player_id = ? AND ${RECORD_FILTER}
         ORDER BY m.updated_at, m.id`,
      )
      .bind(playerId)
      .all<{ won: number }>(),
  ]);
  return {
    play: playStreak(
      days.results.map((row) => row.day),
      dayOf(now),
    ),
    wins: winStreak(results.results.map((row) => row.won === 1)),
  };
}

// The player's record game by game, most-played first. Counts every match
// they are in, lobbies included, the way the hub's `played` does.
export async function gameRecords(db: D1Database, playerId: PlayerId): Promise<GameRecord[]> {
  const { results } = await db
    .prepare(
      `SELECT m.game_id AS gameId,
              COUNT(*) AS played,
              COALESCE(SUM(m.status = 'done'), 0) AS finished,
              COALESCE(SUM(m.status = 'done' AND mp.won = 1), 0) AS won
       FROM match_players mp
       JOIN matches m ON m.id = mp.match_id
       LEFT JOIN players p ON p.id = mp.player_id
       WHERE mp.player_id = ?
         AND (p.stats_since IS NULL OR m.created_at >= p.stats_since)
       GROUP BY m.game_id
       ORDER BY played DESC, m.game_id`,
    )
    .bind(playerId)
    .all<GameRecord>();
  return results;
}

interface RivalRow {
  opponent_id: string;
  nickname: string | null;
  game_id: string;
  played: number;
  wins: number;
  losses: number;
}

function headToHead(played: number, wins: number, losses: number): HeadToHead {
  return { played, wins, losses, draws: played - wins - losses };
}

// The player's head-to-head against everyone they have finished a match with.
// In a match of more than two, each opponent is a pairing of its own: beating
// the table beats everyone at it, and a scoreboard two players both topped is
// a draw between them.
export async function rivals(
  db: D1Database,
  playerId: PlayerId,
  limit = RIVAL_LIMIT,
): Promise<Rival[]> {
  const { results } = await db
    .prepare(
      `SELECT o.player_id AS opponent_id, op.nickname AS nickname, m.game_id AS game_id,
              COUNT(*) AS played,
              COALESCE(SUM(mp.won = 1 AND COALESCE(o.won, 0) = 0), 0) AS wins,
              COALESCE(SUM(o.won = 1 AND COALESCE(mp.won, 0) = 0), 0) AS losses
       FROM match_players mp
       JOIN matches m ON m.id = mp.match_id
       JOIN match_players o ON o.match_id = mp.match_id AND o.player_id <> mp.player_id
       LEFT JOIN players p ON p.id = mp.player_id
       LEFT JOIN players op ON op.id = o.player_id
       WHERE mp.player_id = ? AND ${RECORD_FILTER}
       GROUP BY o.player_id, m.game_id`,
    )
    .bind(playerId)
    .all<RivalRow>();

  const byOpponent = new Map<PlayerId, Rival>();
  for (const row of results) {
    let rival = byOpponent.get(row.opponent_id);
    if (!rival) {
      rival = {
        playerId: row.opponent_id,
        nickname: row.nickname ?? UNKNOWN_NICKNAME,
        ...headToHead(0, 0, 0),
        games: [],
      };
      byOpponent.set(row.opponent_id, rival);
    }
    rival.games.push({ gameId: row.game_id, ...headToHead(row.played, row.wins, row.losses) });
    Object.assign(
      rival,
      headToHead(rival.played + row.played, rival.wins + row.wins, rival.losses + row.losses),
    );
  }
  const list = [...byOpponent.values()];
  for (const rival of list) {
    rival.games.sort((a, b) => b.played - a.played || a.gameId.localeCompare(b.gameId));
  }
  return list
    .sort(
      (a, b) =>
        b.played - a.played ||
        a.nickname.localeCompare(b.nickname) ||
        a.playerId.localeCompare(b.playerId),
    )
    .slice(0, limit);
}

// How long the player took to move, each time a match turned to them and
// they answered it, over the last `REPLY_WINDOW_DAYS`.
export async function replyTimes(
  db: D1Database,
  playerId: PlayerId,
  now: number,
): Promise<PlayerStatsDetail["reply"]> {
  const { results } = await db
    .prepare(
      `SELECT ended_at - started_at AS ms FROM turn_waits
       WHERE player_id = ? AND moved = 1 AND ended_at >= ?
       ORDER BY ms`,
    )
    .bind(playerId, now - REPLY_WINDOW_DAYS * DAY_MS)
    .all<{ ms: number }>();
  const times = results.map((row) => row.ms);
  return { days: REPLY_WINDOW_DAYS, moves: times.length, medianMs: median(times) };
}

export async function playerStatsDetail(
  db: D1Database,
  playerId: PlayerId,
  now: number,
): Promise<PlayerStatsDetail> {
  const [record, streaks, games, rivalList, reply] = await Promise.all([
    playerStats(db, playerId),
    playerStreaks(db, playerId, now),
    gameRecords(db, playerId),
    rivals(db, playerId),
    replyTimes(db, playerId, now),
  ]);
  return { record, streaks, games, rivals: rivalList, reply };
}

// ---------------------------------------------------------------------------
// Everyone, over a window.
// ---------------------------------------------------------------------------

// Who kept matches waiting longest over [from, to). A wait counts for the
// part of it inside the window, and a wait still open counts up to `now` (or
// `to`, if that is sooner), so a match stuck all week counts all week. The
// longest wait is the whole of that one wait, from its start to its end or to
// `now`, however much of it lies outside the window. `stalled` is how many
// matches wait on them right now.
export async function wallOfShame(
  db: D1Database,
  from: number,
  to: number,
  now: number,
  limit = BOARD_LIMIT,
): Promise<ShameEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT w.player_id AS playerId, p.nickname AS nickname,
              SUM(MIN(COALESCE(w.ended_at, ?3), ?2) - MAX(w.started_at, ?1)) AS waitedMs,
              COUNT(*) AS turns,
              MAX(COALESCE(w.ended_at, ?3) - w.started_at) AS longestMs,
              COALESCE(SUM(w.ended_at IS NULL), 0) AS stalled
       FROM turn_waits w
       LEFT JOIN players p ON p.id = w.player_id
       WHERE w.started_at < ?2 AND COALESCE(w.ended_at, ?3) > ?1
       GROUP BY w.player_id
       HAVING waitedMs > 0
       ORDER BY waitedMs DESC, w.player_id
       LIMIT ?4`,
    )
    .bind(from, to, now, limit)
    .all<Omit<ShameEntry, "nickname"> & { nickname: string | null }>();
  return results.map((row) => ({ ...row, nickname: row.nickname ?? UNKNOWN_NICKNAME }));
}

// Who won most of the matches that finished in [from, to), fewest played
// first on a tie: seven from eight beats seven from twelve.
export async function champions(
  db: D1Database,
  from: number,
  to: number,
  limit = BOARD_LIMIT,
): Promise<ChampionEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT mp.player_id AS playerId, p.nickname AS nickname,
              COALESCE(SUM(mp.won = 1), 0) AS won,
              COUNT(*) AS finished
       FROM match_players mp
       JOIN matches m ON m.id = mp.match_id
       LEFT JOIN players p ON p.id = mp.player_id
       WHERE m.status = 'done' AND m.result_kind IS NOT NULL
         AND m.updated_at >= ? AND m.updated_at < ?
       GROUP BY mp.player_id
       -- Spelled out, since in HAVING the alias would lose to the column mp.won.
       HAVING SUM(mp.won = 1) > 0
       ORDER BY won DESC, finished ASC, mp.player_id
       LIMIT ?`,
    )
    .bind(from, to, limit)
    .all<Omit<ChampionEntry, "nickname"> & { nickname: string | null }>();
  return results.map((row) => ({ ...row, nickname: row.nickname ?? UNKNOWN_NICKNAME }));
}

// The last seven days, as everyone sees them.
export async function leaderboard(db: D1Database, now: number): Promise<Leaderboard> {
  const from = now - LEADERBOARD_WINDOW_MS;
  const [championList, shame] = await Promise.all([
    champions(db, from, now),
    wallOfShame(db, from, now, now),
  ]);
  return { from, to: now, champions: championList, shame };
}

// Every player's play days since `sinceDay`, for the recap, which has no one
// player to ask about.
export async function playDaysOfEveryone(
  db: D1Database,
  sinceDay: string,
): Promise<Map<PlayerId, string[]>> {
  const { results } = await db
    .prepare(
      `SELECT w.player_id AS player_id, ${WAIT_DAY} AS day FROM turn_waits w
       WHERE w.moved = 1 AND w.ended_at >= ?1
       UNION
       SELECT player_id, day FROM daily_runs WHERE day >= ?2`,
    )
    .bind(Date.parse(`${sinceDay}T00:00:00Z`), sinceDay)
    .all<{ player_id: string; day: string }>();
  const days = new Map<PlayerId, string[]>();
  for (const row of results) {
    const list = days.get(row.player_id) ?? [];
    list.push(row.day);
    days.set(row.player_id, list);
  }
  return days;
}

// Every player's current win streak, for the recap.
export async function winStreaksOfEveryone(db: D1Database): Promise<Map<PlayerId, Streak>> {
  const { results } = await db
    .prepare(
      `SELECT mp.player_id AS player_id, COALESCE(mp.won, 0) AS won
       FROM match_players mp
       JOIN matches m ON m.id = mp.match_id
       LEFT JOIN players p ON p.id = mp.player_id
       WHERE ${RECORD_FILTER}
       ORDER BY mp.player_id, m.updated_at, m.id`,
    )
    .bind()
    .all<{ player_id: string; won: number }>();
  const byPlayer = new Map<PlayerId, boolean[]>();
  for (const row of results) {
    const list = byPlayer.get(row.player_id) ?? [];
    list.push(row.won === 1);
    byPlayer.set(row.player_id, list);
  }
  return new Map([...byPlayer].map(([id, list]) => [id, winStreak(list)]));
}
