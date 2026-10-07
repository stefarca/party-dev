import { getDailyMeta } from "../games/catalog";
import {
  ACHIEVEMENTS,
  SLOWPOKE_MS,
  TOP_OF_THE_CHART_MIN_RANKED,
  getAchievement,
} from "../shared/achievements";
import type { AchievementId } from "../shared/achievements";
import { addDays, dayEnd, dayOf } from "../shared/daily";
import type { AchievementProgress, AchievementsResponse, PlayerId } from "../shared/protocol";

// What a player has earned, worked out from the derived index on every read,
// the way the stats are: `matches`/`match_players` for results, `turn_waits`
// for moves, `daily_runs` for the daily games. Nothing here is stored, so a
// player who had played before achievements existed has every one they had
// already earned the first time they look, and nothing in a Durable Object
// has to know achievements exist.
//
// Unlike the record, achievements count everything the player ever did: a
// reset starts the record over, never takes back what was earned. And every
// measure only grows, so nothing earned can be lost — the index rows a match
// leaves are only ever deleted for a lobby, which counts towards nothing here.
//
// The one thing stored is `achievements_seen`: which levels the player has
// been told about, so the client says "unlocked" once rather than on every
// load.

type Progress = Pick<AchievementProgress, "value" | "unlockedAt">;

function byTime(a: number, b: number): number {
  return a - b;
}

// When each of `tiers` was reached, as long as `at` can say: it returns when
// the measure first came to `goal`, or undefined while it has not.
function reached(tiers: readonly number[], at: (goal: number) => number | undefined): number[] {
  const unlockedAt: number[] = [];
  for (const goal of tiers) {
    const time = at(goal);
    if (time === undefined) break;
    unlockedAt.push(time);
  }
  return unlockedAt;
}

// A count that went up by one at each of `times`.
export function fromCount(times: Iterable<number>, tiers: readonly number[]): Progress {
  const sorted = [...times].sort(byTime);
  return { value: sorted.length, unlockedAt: reached(tiers, (goal) => sorted[goal - 1]) };
}

// The first time each of a set of things happened: a count of different ones.
function fromFirsts(firsts: Map<string, number>, tiers: readonly number[]): Progress {
  return fromCount(firsts.values(), tiers);
}

// The biggest of several counts, each going up by one at each of its times: a
// tier is reached when the first of them reaches it.
export function fromGroups(groups: Iterable<number[]>, tiers: readonly number[]): Progress {
  const sorted = [...groups].map((times) => [...times].sort(byTime));
  const value = sorted.reduce((most, times) => Math.max(most, times.length), 0);
  return {
    value,
    unlockedAt: reached(tiers, (goal) => {
      let first: number | undefined;
      for (const times of sorted) {
        if (times.length >= goal && (first === undefined || times[goal - 1] < first)) {
          first = times[goal - 1];
        }
      }
      return first;
    }),
  };
}

// A run that grows and breaks, as the length it has after each step, in the
// order the steps happened. The measure is its longest.
export function fromRuns(steps: { at: number; run: number }[], tiers: readonly number[]): Progress {
  const value = steps.reduce((best, step) => Math.max(best, step.run), 0);
  return { value, unlockedAt: reached(tiers, (goal) => steps.find((s) => s.run >= goal)?.at) };
}

// How a sorted list of days with something played on them makes a play
// streak: each day continues the run if the day before it is in the list.
export function playRuns(days: { day: string; at: number }[]): { at: number; run: number }[] {
  const steps: { at: number; run: number }[] = [];
  days.forEach(({ day, at }, i) => {
    const previous = steps[i - 1];
    const continues = previous !== undefined && addDays(days[i - 1].day, 1) === day;
    steps.push({ at, run: continues ? previous.run + 1 : 1 });
  });
  return steps;
}

// The player's matches, oldest first. A lobby is in here too, and counts for
// nothing: every achievement about a match asks for one that got under way.
interface MatchRow {
  gameId: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  resultKind: string | null;
  hostId: string | null;
  visibility: string | null;
  won: number | null;
}

interface RunRow {
  gameId: string;
  day: string;
  status: string;
  score: number | null;
  startedAt: number;
  finishedAt: number | null;
  // That day's chart: its best score either way, and how many runs are ranked on it.
  low: number | null;
  high: number | null;
  ranked: number;
}

export async function achievementsOf(
  db: D1Database,
  playerId: PlayerId,
  now: number,
): Promise<AchievementProgress[]> {
  const [matches, opponents, days, runs, slowMoves] = await Promise.all([
    db
      .prepare(
        `SELECT m.game_id AS gameId, m.status AS status,
                COALESCE(m.created_at, 0) AS createdAt, COALESCE(m.updated_at, 0) AS updatedAt,
                m.result_kind AS resultKind, m.host_id AS hostId, m.visibility AS visibility,
                mp.won AS won
         FROM match_players mp
         JOIN matches m ON m.id = mp.match_id
         WHERE mp.player_id = ?
         ORDER BY m.updated_at, m.id`,
      )
      .bind(playerId)
      .all<MatchRow>(),
    // Everyone the player has finished a match with, once per match, a void
    // one aside. A finished match updates no more, so its `updated_at` is
    // when it ended.
    db
      .prepare(
        `SELECT o.player_id AS opponent, COALESCE(m.updated_at, 0) AS at
         FROM match_players mp
         JOIN matches m ON m.id = mp.match_id
         JOIN match_players o ON o.match_id = mp.match_id AND o.player_id <> mp.player_id
         WHERE mp.player_id = ? AND m.status = 'done' AND m.result_kind IS NOT 'void'`,
      )
      .bind(playerId)
      .all<{ opponent: string; at: number }>(),
    // The days the player moved in a match or played a daily game, the same
    // days their play streak counts, with the first thing they did on each.
    db
      .prepare(
        `SELECT day, MIN(at) AS at FROM (
           SELECT strftime('%Y-%m-%d', ended_at / 1000, 'unixepoch') AS day, ended_at AS at
           FROM turn_waits WHERE player_id = ?1 AND moved = 1 AND ended_at IS NOT NULL
           UNION ALL
           SELECT day, started_at AS at FROM daily_runs WHERE player_id = ?1
         )
         GROUP BY day
         ORDER BY day`,
      )
      .bind(playerId)
      .all<{ day: string; at: number }>(),
    db
      .prepare(
        `SELECT r.game_id AS gameId, r.day AS day, r.status AS status, r.score AS score,
                r.started_at AS startedAt, r.finished_at AS finishedAt,
                (SELECT MIN(o.score) FROM daily_runs o
                 WHERE o.game_id = r.game_id AND o.day = r.day AND o.status = 'done') AS low,
                (SELECT MAX(o.score) FROM daily_runs o
                 WHERE o.game_id = r.game_id AND o.day = r.day AND o.status = 'done') AS high,
                (SELECT COUNT(o.score) FROM daily_runs o
                 WHERE o.game_id = r.game_id AND o.day = r.day AND o.status = 'done') AS ranked
         FROM daily_runs r
         WHERE r.player_id = ?`,
      )
      .bind(playerId)
      .all<RunRow>(),
    db
      .prepare(
        `SELECT ended_at AS at FROM turn_waits
         WHERE player_id = ? AND moved = 1 AND ended_at IS NOT NULL AND ended_at - started_at >= ?`,
      )
      .bind(playerId, SLOWPOKE_MS)
      .all<{ at: number }>(),
  ]);

  // A void match, one nobody moved in before time ran out, finished nothing:
  // it counts towards no measure of finished matches. It still counts as
  // hosted, since that is earned when the match starts and must not be lost.
  const finished = matches.results.filter((m) => m.status === "done" && m.resultKind !== "void");
  const underWay = matches.results.filter((m) => m.status !== "lobby");
  const hosted = underWay.filter((m) => m.hostId === playerId);
  const finishedRuns = runs.results.filter((r) => r.status === "done");

  // A win streak counts only the matches whose result the index knows, the
  // same ones the stats page's does.
  let winRun = 0;
  const winSteps = finished
    .filter((m) => m.resultKind !== null)
    .map((m) => {
      winRun = m.won === 1 ? winRun + 1 : 0;
      return { at: m.updatedAt, run: winRun };
    });

  const gamesPlayed = new Map<string, number>();
  const firstAt = (firsts: Map<string, number>, key: string, at: number) => {
    const known = firsts.get(key);
    if (known === undefined || at < known) firsts.set(key, at);
  };
  for (const m of finished) firstAt(gamesPlayed, m.gameId, m.updatedAt);
  for (const r of finishedRuns) firstAt(gamesPlayed, r.gameId, r.finishedAt ?? r.startedAt);

  const opponentsMet = new Map<string, number>();
  const matchesAgainst = new Map<string, number[]>();
  for (const { opponent, at } of opponents.results) {
    firstAt(opponentsMet, opponent, at);
    const times = matchesAgainst.get(opponent) ?? [];
    times.push(at);
    matchesAgainst.set(opponent, times);
  }

  const gamesByDay = new Map<string, Map<string, number>>();
  for (const r of finishedRuns) {
    const games = gamesByDay.get(r.day) ?? new Map<string, number>();
    firstAt(games, r.gameId, r.finishedAt ?? r.startedAt);
    gamesByDay.set(r.day, games);
  }

  // A chart is final once its day is over, so only a day before today can be
  // topped for good. A tie for first tops it for everyone on it.
  const today = dayOf(now);
  const topped = finishedRuns.filter((r) => {
    const meta = getDailyMeta(r.gameId);
    if (!meta || r.score === null || r.day >= today) return false;
    if (r.ranked < TOP_OF_THE_CHART_MIN_RANKED) return false;
    return r.score === (meta.order === "asc" ? r.low : r.high);
  });

  const measures: Record<AchievementId, (tiers: readonly number[]) => Progress> = {
    winner: (tiers) =>
      fromCount(
        finished.filter((m) => m.won === 1).map((m) => m.updatedAt),
        tiers,
      ),
    hotStreak: (tiers) => fromRuns(winSteps, tiers),
    veteran: (tiers) =>
      fromCount(
        finished.map((m) => m.updatedAt),
        tiers,
      ),
    regular: (tiers) => fromRuns(playRuns(days.results), tiers),
    explorer: (tiers) => fromFirsts(gamesPlayed, tiers),
    social: (tiers) => fromFirsts(opponentsMet, tiers),
    rivalry: (tiers) => fromGroups(matchesAgainst.values(), tiers),
    host: (tiers) =>
      fromCount(
        hosted.map((m) => m.createdAt),
        tiers,
      ),
    openHouse: (tiers) =>
      fromCount(
        hosted.filter((m) => m.visibility === "public").map((m) => m.createdAt),
        tiers,
      ),
    stalemate: (tiers) =>
      fromCount(
        finished.filter((m) => m.resultKind === "draw").map((m) => m.updatedAt),
        tiers,
      ),
    slowpoke: (tiers) =>
      fromCount(
        slowMoves.results.map((row) => row.at),
        tiers,
      ),
    dailyHabit: (tiers) =>
      fromCount(
        finishedRuns.map((r) => r.finishedAt ?? r.startedAt),
        tiers,
      ),
    cleanSweep: (tiers) =>
      fromGroups(
        [...gamesByDay.values()].map((games) => [...games.values()]),
        tiers,
      ),
    topOfTheChart: (tiers) =>
      fromCount(
        topped.map((r) => dayEnd(r.day)),
        tiers,
      ),
  };

  return ACHIEVEMENTS.map((achievement) => ({
    id: achievement.id,
    ...measures[achievement.id](achievement.tiers),
  }));
}

// The levels the player has been told about, by achievement. An id the
// catalog no longer has is left out.
export async function seenAchievements(
  db: D1Database,
  playerId: PlayerId,
): Promise<AchievementsResponse["seen"]> {
  const { results } = await db
    .prepare("SELECT achievement_id AS id, level FROM achievements_seen WHERE player_id = ?")
    .bind(playerId)
    .all<{ id: string; level: number }>();
  const seen: AchievementsResponse["seen"] = {};
  for (const { id, level } of results) {
    const achievement = getAchievement(id);
    if (achievement) seen[achievement.id] = level;
  }
  return seen;
}

// Records that the player has been told about `levels`. A level never goes
// down, so a device that heard about less than another already did, and says
// so second, changes nothing. Ids the catalog does not know are dropped, and a
// level is capped at the achievement's own number of tiers.
export async function markAchievementsSeen(
  db: D1Database,
  playerId: PlayerId,
  levels: Record<string, number>,
): Promise<void> {
  const known: Record<string, number> = {};
  for (const [id, level] of Object.entries(levels)) {
    const achievement = getAchievement(id);
    if (achievement) known[id] = Math.min(level, achievement.tiers.length);
  }
  if (Object.keys(known).length === 0) return;
  // One statement for any number of rows, with a bound parameter count that
  // does not grow with the catalog. `WHERE true` is SQLite's own fix for an
  // upsert whose rows come from a SELECT: without it, ON CONFLICT would parse
  // as part of the join.
  await db
    .prepare(
      `INSERT INTO achievements_seen (player_id, achievement_id, level)
       SELECT ?1, key, value FROM json_each(?2) WHERE true
       ON CONFLICT (player_id, achievement_id)
       DO UPDATE SET level = MAX(level, excluded.level)`,
    )
    .bind(playerId, JSON.stringify(known))
    .run();
}
