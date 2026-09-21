import { DAILY_CATALOG } from "../games/catalog";
import type { DailyGameMeta } from "../games/catalog";
import type { ActionDescription } from "../shared/game";
import { UNKNOWN_NICKNAME } from "../shared/nickname";
import type {
  DailyChart,
  DailyChartEntry,
  DailyGameSummary,
  DailyRunStatus,
  PlayerId,
} from "../shared/protocol";

// The daily games' charts, read from the `daily_runs` index. Everything here
// comes from derived rows each run's `DailyDO` writes when it starts and when
// it ends, so a chart can lag a run by a moment; a run's truth is never read
// from here. Names come from the player registry, like every roster.

// How many finished runs a chart lists. The caller's own run is reported
// beside the list wherever it placed, so a long chart never hides it.
export const CHART_LIMIT = 50;

interface ChartRow {
  player_id: string;
  nickname: string | null;
  status: DailyRunStatus;
  score: number | null;
  detail: string | null;
  finished_at: number | null;
}

const COLUMNS = `r.player_id AS player_id, p.nickname AS nickname, r.status AS status,
                 r.score AS score, r.detail AS detail, r.finished_at AS finished_at`;

function detailOf(raw: string | null): ActionDescription | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ActionDescription | null;
    return parsed && typeof parsed.key === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function entryOf(row: ChartRow, rank: number | null): DailyChartEntry {
  return {
    playerId: row.player_id,
    nickname: row.nickname ?? UNKNOWN_NICKNAME,
    status: row.status,
    rank,
    score: row.score,
    detail: detailOf(row.detail),
    finishedAt: row.finished_at,
  };
}

// Ranks rows already in chart order. Equal scores share a rank and the next
// score skips the places they took (1, 2, 2, 4), and a run with no score has
// no rank. The rows are a prefix of the whole chart, so every rank is exact.
function ranked(rows: ChartRow[]): DailyChartEntry[] {
  const entries: DailyChartEntry[] = [];
  rows.forEach((row, i) => {
    const previous = entries[i - 1];
    const rank =
      row.score === null
        ? null
        : previous?.score === row.score && previous.rank !== null
          ? previous.rank
          : i + 1;
    entries.push(entryOf(row, rank));
  });
  return entries;
}

// Where a finished run outside the listed page placed: one more than the
// number of runs that beat it outright.
async function rankOf(
  db: D1Database,
  game: DailyGameMeta,
  day: string,
  row: ChartRow,
): Promise<number | null> {
  if (row.status !== "done" || row.score === null) return null;
  const beats = game.order === "asc" ? "<" : ">";
  const result = await db
    .prepare(
      `SELECT COUNT(*) AS ahead FROM daily_runs
       WHERE game_id = ? AND day = ? AND status = 'done' AND score ${beats} ?`,
    )
    .bind(game.id, day, row.score)
    .first<{ ahead: number }>();
  return (result?.ahead ?? 0) + 1;
}

// `game`'s chart for `day`, as `playerId` sees it: the top `limit` finished
// runs, best first, their own run wherever it is, and how many runs there
// are. Ranked runs come before runs with no score, and a tie is listed in the
// order its runs finished. The direction comes from the game's own meta, never
// from the request, which is what makes interpolating it safe.
export async function dailyChart(
  db: D1Database,
  game: DailyGameMeta,
  day: string,
  playerId: PlayerId,
  limit = CHART_LIMIT,
): Promise<DailyChart> {
  const direction = game.order === "asc" ? "ASC" : "DESC";
  const [top, counts, own] = await Promise.all([
    db
      .prepare(
        `SELECT ${COLUMNS}
         FROM daily_runs r LEFT JOIN players p ON p.id = r.player_id
         WHERE r.game_id = ? AND r.day = ? AND r.status = 'done'
         ORDER BY r.score IS NULL, r.score ${direction}, r.finished_at, r.player_id
         LIMIT ?`,
      )
      .bind(game.id, day, limit)
      .all<ChartRow>(),
    db
      .prepare(
        `SELECT COALESCE(SUM(status = 'done'), 0) AS finished,
                COALESCE(SUM(status = 'active'), 0) AS playing
         FROM daily_runs WHERE game_id = ? AND day = ?`,
      )
      .bind(game.id, day)
      .first<{ finished: number; playing: number }>(),
    db
      .prepare(
        `SELECT ${COLUMNS}
         FROM daily_runs r LEFT JOIN players p ON p.id = r.player_id
         WHERE r.game_id = ? AND r.day = ? AND r.player_id = ?`,
      )
      .bind(game.id, day, playerId)
      .first<ChartRow>(),
  ]);

  const entries = ranked(top.results);
  let mine: DailyChartEntry | null = null;
  if (own) {
    mine =
      entries.find((entry) => entry.playerId === playerId) ??
      entryOf(own, await rankOf(db, game, day, own));
  }
  return {
    gameId: game.id,
    day,
    entries,
    mine,
    finished: counts?.finished ?? 0,
    playing: counts?.playing ?? 0,
  };
}

// Every daily game as the hub shows it for `day`: the caller's own run, how
// many runs are on the chart and who leads it. One page-of-one chart read per
// game, so the hub and the chart can never rank a run differently.
export function dailySummaries(
  db: D1Database,
  day: string,
  playerId: PlayerId,
): Promise<DailyGameSummary[]> {
  return Promise.all(
    DAILY_CATALOG.map(async (game) => {
      const chart = await dailyChart(db, game, day, playerId, 1);
      const top = chart.entries[0];
      return {
        gameId: game.id,
        mine: chart.mine
          ? { status: chart.mine.status, score: chart.mine.score, rank: chart.mine.rank }
          : null,
        finished: chart.finished,
        leader:
          top && top.rank !== null && top.score !== null
            ? { playerId: top.playerId, nickname: top.nickname, score: top.score }
            : null,
      };
    }),
  );
}
