import { DAILY_CATALOG, getDailyMeta, getGameMeta } from "../games/catalog";
import { addDays, dayOf, dayStart } from "../shared/daily";
import { UNKNOWN_NICKNAME } from "../shared/nickname";
import type { ChampionEntry, PlayerId, ShameEntry } from "../shared/protocol";
import { postSlackMessage } from "./nudge";
import {
  champions,
  median,
  playDaysOfEveryone,
  playStreak,
  wallOfShame,
  winStreaksOfEveryone,
} from "./stats";

// The weekly recap: one Slack message every Monday morning, about the seven
// UTC days that just ended. In an async app the hard part is getting people
// to come back, and a recap that names names — who won, who is on a streak,
// who has kept everyone waiting — does that better than a nudge about one
// match. Like a nudge, it is English and goes to the one shared channel.
//
// It reads only the derived index (worker/stats.ts), so it wakes no Durable
// Object. Nothing here may throw out of `sendWeeklyRecap()`, which the cron
// hands to `waitUntil()`: a failure costs a log line and this week's recap.

// Mondays at 08:00 UTC. Must match `triggers.crons` in wrangler.jsonc, which
// is how `scheduled()` in worker/index.ts tells this run from the lobby sweep.
export const RECAP_CRON = "0 8 * * 1";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// How many players each section names.
const TOP = 3;
// A win streak or play streak worth a mention.
const STREAK_WORTH_MENTIONING = 3;
// Matches two players must have finished against each other in the week for
// theirs to be the rivalry of the week.
const RIVALRY_MIN_MATCHES = 2;
// Moves a player must have made in the week to be the quickest to reply.
const QUICKEST_MIN_MOVES = 5;
// How long a match must have been waiting on someone to be called stalled.
const STALLED_AFTER_MS = 2 * DAY;
// How far back play streaks are read. A longer streak is reported as this.
const STREAK_LOOKBACK_DAYS = 400;

export interface Named {
  playerId: PlayerId;
  nickname: string;
}

export interface RecapData {
  // The first UTC day the recap covers, which is also what keys it in
  // `recaps`, and the instants the week begins and ends.
  week: string;
  from: number;
  to: number;
  matches: number; // finished in the week
  moves: number;
  players: number; // who made a move or played a daily game
  dailyRuns: number;
  champions: ChampionEntry[];
  onFire: (Named & { streak: number })[];
  rivalry: {
    a: Named;
    b: Named;
    aWins: number;
    bWins: number;
    draws: number;
    gameIds: string[];
  } | null;
  dailyChamps: (Named & { tops: number })[];
  playStreaks: (Named & { days: number })[];
  quickest: (Named & { medianMs: number; moves: number }) | null;
  shame: ShameEntry[];
  stalled: { slow: Named; waiting: Named[]; gameId: string; since: number }[];
}

async function namesOf(db: D1Database, ids: PlayerId[]): Promise<Map<PlayerId, string>> {
  if (ids.length === 0) return new Map();
  const { results } = await db
    .prepare("SELECT id, nickname FROM players WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(ids))
    .all<{ id: string; nickname: string }>();
  return new Map(results.map((row) => [row.id, row.nickname]));
}

function named(names: Map<PlayerId, string>, playerId: PlayerId): Named {
  return { playerId, nickname: names.get(playerId) ?? UNKNOWN_NICKNAME };
}

// The top `n` of `entries` by `score`, highest first, ties by id so the recap
// comes out the same however often it is gathered.
function topBy<T extends { playerId: PlayerId }>(entries: T[], score: (e: T) => number, n = TOP) {
  return entries
    .sort((a, b) => score(b) - score(a) || a.playerId.localeCompare(b.playerId))
    .slice(0, n);
}

// Everything the recap of the week before `now` says. `now` is the cron's
// scheduled time, so the week is whole days: the seven before today's.
export async function gatherRecap(db: D1Database, now: number): Promise<RecapData> {
  const today = dayOf(now);
  const week = addDays(today, -7);
  const from = dayStart(week);
  const to = dayStart(today);

  const [counts, championList, shame, rivalryRow, replyRows, stalledRows, days, winStreaks] =
    await Promise.all([
      db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM matches
              WHERE status = 'done' AND updated_at >= ?1 AND updated_at < ?2) AS matches,
             (SELECT COUNT(*) FROM turn_waits
              WHERE moved = 1 AND ended_at >= ?1 AND ended_at < ?2) AS moves,
             (SELECT COUNT(*) FROM (
                SELECT player_id FROM turn_waits WHERE moved = 1 AND ended_at >= ?1 AND ended_at < ?2
                UNION
                SELECT player_id FROM daily_runs WHERE day >= ?3 AND day < ?4)) AS players,
             (SELECT COUNT(*) FROM daily_runs WHERE day >= ?3 AND day < ?4) AS dailyRuns`,
        )
        .bind(from, to, week, today)
        .first<{ matches: number; moves: number; players: number; dailyRuns: number }>(),
      champions(db, from, to, TOP),
      wallOfShame(db, from, to, now, TOP),
      // The pair who finished most matches against each other, the closest
      // contest first on a tie.
      db
        .prepare(
          `SELECT a.player_id AS a, b.player_id AS b, COUNT(*) AS played,
                  COALESCE(SUM(a.won = 1 AND COALESCE(b.won, 0) = 0), 0) AS aWins,
                  COALESCE(SUM(b.won = 1 AND COALESCE(a.won, 0) = 0), 0) AS bWins,
                  group_concat(DISTINCT m.game_id) AS games
           FROM matches m
           JOIN match_players a ON a.match_id = m.id
           JOIN match_players b ON b.match_id = m.id AND a.player_id < b.player_id
           WHERE m.status = 'done' AND m.result_kind IS NOT NULL
             AND m.updated_at >= ? AND m.updated_at < ?
           GROUP BY a.player_id, b.player_id
           HAVING COUNT(*) >= ?
           ORDER BY played DESC, ABS(aWins - bWins), a.player_id, b.player_id
           LIMIT 1`,
        )
        .bind(from, to, RIVALRY_MIN_MATCHES)
        .first<{
          a: string;
          b: string;
          played: number;
          aWins: number;
          bWins: number;
          games: string;
        }>(),
      db
        .prepare(
          `SELECT player_id, ended_at - started_at AS ms FROM turn_waits
           WHERE moved = 1 AND ended_at >= ? AND ended_at < ?
           ORDER BY player_id, ms`,
        )
        .bind(from, to)
        .all<{ player_id: string; ms: number }>(),
      // The matches that have waited longest on one player, and are still
      // waiting. Only the players not being waited on themselves are the ones
      // left waiting.
      db
        .prepare(
          `SELECT w.match_id AS match_id, w.player_id AS player_id, w.started_at AS started_at,
                  m.game_id AS game_id,
                  (SELECT json_group_array(o.player_id) FROM match_players o
                   WHERE o.match_id = w.match_id AND o.waiting = 0) AS waiting
           FROM turn_waits w
           JOIN matches m ON m.id = w.match_id
           WHERE w.ended_at IS NULL AND m.status = 'active' AND w.started_at <= ?
           ORDER BY w.started_at, w.match_id
           LIMIT ?`,
        )
        .bind(now - STALLED_AFTER_MS, TOP * 2)
        .all<{
          match_id: string;
          player_id: string;
          started_at: number;
          game_id: string;
          waiting: string;
        }>(),
      playDaysOfEveryone(db, addDays(today, -STREAK_LOOKBACK_DAYS)),
      winStreaksOfEveryone(db),
    ]);

  // The best daily score each day, per game: whoever matched it topped that
  // day's chart. The direction comes from the game's own meta, never from
  // anything a player sent, which is what makes interpolating it safe.
  const tops = new Map<PlayerId, number>();
  for (const game of DAILY_CATALOG) {
    const best = game.order === "asc" ? "MIN" : "MAX";
    const { results } = await db
      .prepare(
        `SELECT r.player_id AS player_id, COUNT(*) AS tops FROM daily_runs r
         WHERE r.game_id = ?1 AND r.day >= ?2 AND r.day < ?3
           AND r.status = 'done' AND r.score IS NOT NULL
           AND r.score = (SELECT ${best}(x.score) FROM daily_runs x
                          WHERE x.game_id = r.game_id AND x.day = r.day
                            AND x.status = 'done' AND x.score IS NOT NULL)
         GROUP BY r.player_id`,
      )
      .bind(game.id, week, today)
      .all<{ player_id: string; tops: number }>();
    for (const row of results) tops.set(row.player_id, (tops.get(row.player_id) ?? 0) + row.tops);
  }
  const mostTops = Math.max(0, ...tops.values());

  const replies = new Map<PlayerId, number[]>();
  for (const row of replyRows.results) {
    const list = replies.get(row.player_id) ?? [];
    list.push(row.ms);
    replies.set(row.player_id, list);
  }
  const quickestRow = topBy(
    [...replies]
      .filter(([, times]) => times.length >= QUICKEST_MIN_MOVES)
      .map(([playerId, times]) => ({
        playerId,
        medianMs: median(times) ?? 0,
        moves: times.length,
      })),
    (e) => -e.medianMs,
    1,
  )[0];

  const onFire = topBy(
    [...winStreaks]
      .filter(([, streak]) => streak.current >= STREAK_WORTH_MENTIONING)
      .map(([playerId, streak]) => ({ playerId, streak: streak.current })),
    (e) => e.streak,
  );
  const streaks = topBy(
    [...days]
      .map(([playerId, list]) => ({ playerId, days: playStreak(list, today).current }))
      .filter((e) => e.days >= STREAK_WORTH_MENTIONING),
    (e) => e.days,
  );
  const dailyChamps = [...tops]
    .filter(([, n]) => n === mostTops && n > 0)
    .map(([playerId, n]) => ({ playerId, tops: n }))
    .sort((a, b) => a.playerId.localeCompare(b.playerId));

  const stalledParsed = stalledRows.results
    .map((row) => ({ ...row, waitingIds: JSON.parse(row.waiting) as PlayerId[] }))
    .filter((row) => row.waitingIds.length > 0)
    .slice(0, TOP);

  const names = await namesOf(db, [
    ...(rivalryRow ? [rivalryRow.a, rivalryRow.b] : []),
    ...(quickestRow ? [quickestRow.playerId] : []),
    ...onFire.map((e) => e.playerId),
    ...streaks.map((e) => e.playerId),
    ...dailyChamps.map((e) => e.playerId),
    ...stalledParsed.flatMap((row) => [row.player_id, ...row.waitingIds]),
  ]);

  return {
    week,
    from,
    to,
    matches: counts?.matches ?? 0,
    moves: counts?.moves ?? 0,
    players: counts?.players ?? 0,
    dailyRuns: counts?.dailyRuns ?? 0,
    champions: championList,
    onFire: onFire.map((e) => ({ ...named(names, e.playerId), streak: e.streak })),
    rivalry: rivalryRow
      ? {
          a: named(names, rivalryRow.a),
          b: named(names, rivalryRow.b),
          aWins: rivalryRow.aWins,
          bWins: rivalryRow.bWins,
          draws: rivalryRow.played - rivalryRow.aWins - rivalryRow.bWins,
          gameIds: rivalryRow.games.split(",").sort(),
        }
      : null,
    dailyChamps: dailyChamps.map((e) => ({ ...named(names, e.playerId), tops: e.tops })),
    playStreaks: streaks.map((e) => ({ ...named(names, e.playerId), days: e.days })),
    quickest: quickestRow
      ? {
          ...named(names, quickestRow.playerId),
          medianMs: quickestRow.medianMs,
          moves: quickestRow.moves,
        }
      : null,
    shame,
    stalled: stalledParsed.map((row) => ({
      slow: named(names, row.player_id),
      waiting: row.waitingIds.map((id) => named(names, id)),
      gameId: row.game_id,
      since: row.started_at,
    })),
  };
}

// Whether the week gave the recap nothing to say. A week with no moves but a
// match stuck on someone still has something to say: that is the point.
export function isQuietWeek(data: RecapData): boolean {
  return (
    data.matches === 0 && data.moves === 0 && data.dailyRuns === 0 && data.stalled.length === 0
  );
}

// ---------------------------------------------------------------------------
// The message.
// ---------------------------------------------------------------------------

// A nickname as Slack reads it. Slack treats `&`, `<` and `>` as markup — a
// nickname of "<!channel>" would ping everyone — so they are escaped.
function slackEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const who = (player: Named) => slackEscape(player.nickname);
const bold = (player: Named) => `*${who(player)}*`;

// "3d 4h", "5h 12m", "14m", "under a minute".
export function recapDuration(ms: number): string {
  if (ms >= DAY) {
    const hours = Math.floor((ms % DAY) / HOUR);
    return hours > 0 ? `${Math.floor(ms / DAY)}d ${hours}h` : `${Math.floor(ms / DAY)}d`;
  }
  if (ms >= HOUR) {
    const minutes = Math.floor((ms % HOUR) / MINUTE);
    return minutes > 0 ? `${Math.floor(ms / HOUR)}h ${minutes}m` : `${Math.floor(ms / HOUR)}h`;
  }
  if (ms >= MINUTE) return `${Math.floor(ms / MINUTE)}m`;
  return "under a minute";
}

function gameName(gameId: string): string {
  return getGameMeta(gameId)?.name ?? getDailyMeta(gameId)?.name ?? gameId;
}

function plural(n: number, one: string, other = `${one}s`): string {
  return `${n} ${n === 1 ? one : other}`;
}

// "Ada", "Ada and Bo", "Ada, Bo and Cy".
function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// The jabs. One of each is picked per week, the same one however often that
// week's recap is composed, so a re-run reads the same and tests can pin it.
const CHAMPION_JABS = [
  "Somebody stop them.",
  "The rest of you have a week to do something about this.",
  "Bow accordingly.",
  "Humble in victory, presumably.",
];
const ON_FIRE_JABS = [
  "Who's going to end it?",
  "Still unbeaten. For now.",
  "Anyone brave enough to try?",
];
const RIVALRY_JABS = [
  "Rematch, anyone?",
  "This is getting personal.",
  "Neither of them is letting this go.",
];
const SHAME_JABS = [
  (name: string) => `${name}, your opponents have started a support group.`,
  (name: string) => `${name}, moves are free. You can make one.`,
  (name: string) => `${name}, the snails have asked us to stop comparing them to you.`,
  (name: string) => `${name}, your opponents have aged visibly.`,
];
const STALLED_JABS = [
  "They're fine. They're totally fine.",
  "The boards are gathering dust.",
  "Somebody check on them.",
];

function pick<T>(list: T[], week: string): T {
  const index = Math.floor(dayStart(week) / (7 * DAY));
  return list[((index % list.length) + list.length) % list.length];
}

// The recap as one Slack message, in Slack's own markup. `baseUrl` is the
// app's address, which the message ends on.
export function composeRecap(data: RecapData, baseUrl: string, now: number): string {
  const range = new Intl.DateTimeFormat("en", { timeZone: "UTC", month: "short", day: "numeric" });
  const lines: string[] = [
    `📊 *Pimpom weekly recap* · ${range.format(data.from)} – ${range.format(data.to - 1)}`,
  ];

  const totals = [
    plural(data.matches, "match", "matches") + " finished",
    plural(data.moves, "move"),
    plural(data.dailyRuns, "daily run"),
  ];
  lines.push(
    data.players > 0
      ? `${listOf(totals)}, from ${plural(data.players, "player")}.`
      : "Not a single move all week. The boards miss you.",
  );

  const highlights: string[] = [];
  const [champ] = data.champions;
  if (champ) {
    highlights.push(
      `🏆 *Champion of the week:* ${bold(champ)}, ${champ.won} ${champ.won === 1 ? "win" : "wins"} from ${plural(champ.finished, "match", "matches")}. ${pick(CHAMPION_JABS, data.week)}`,
    );
  }
  if (data.onFire.length > 0) {
    const [hottest] = data.onFire;
    const rest = data.onFire.slice(1).map((e) => `${who(e)} (${e.streak})`);
    highlights.push(
      `🔥 *On fire:* ${bold(hottest)} has won ${hottest.streak} in a row. ${pick(ON_FIRE_JABS, data.week)}` +
        (rest.length > 0 ? ` Also hot: ${listOf(rest)}.` : ""),
    );
  }
  if (data.rivalry) {
    const { a, b, aWins, bWins, draws, gameIds } = data.rivalry;
    // The one ahead is named first.
    const [first, second] = aWins >= bWins ? [a, b] : [b, a];
    const score = `${Math.max(aWins, bWins)}–${Math.min(aWins, bWins)}`;
    const drawn = draws > 0 ? `, ${plural(draws, "draw")}` : "";
    highlights.push(
      `⚔️ *Rivalry of the week:* ${bold(first)} vs ${bold(second)}, ${score}${drawn} at ${listOf(gameIds.map(gameName))}. ${pick(RIVALRY_JABS, data.week)}`,
    );
  }
  if (data.dailyChamps.length > 0) {
    const [{ tops }] = data.dailyChamps;
    highlights.push(
      `📅 *Daily champ:* ${listOf(data.dailyChamps.map(bold))} topped ${plural(tops, "daily chart")}${data.dailyChamps.length > 1 ? " each" : ""}.`,
    );
  }
  if (data.playStreaks.length > 0) {
    highlights.push(
      `📆 *Streaks:* ${data.playStreaks.map((e) => `${who(e)} ${plural(e.days, "day")}`).join(" · ")}. Don't break them now.`,
    );
  }
  if (data.quickest) {
    highlights.push(
      `⚡ *Quickest on the draw:* ${bold(data.quickest)}, typically back in ${recapDuration(data.quickest.medianMs)}.`,
    );
  }
  if (highlights.length > 0) lines.push("", ...highlights);

  if (data.shame.length > 0) {
    lines.push("", "🐌 *Wall of shame*: who kept everyone waiting longest");
    data.shame.forEach((entry, i) => {
      lines.push(
        `${i + 1}. ${who(entry)}: ${recapDuration(entry.waitedMs)} over ${plural(entry.turns, "turn")} (longest ${recapDuration(entry.longestMs)})`,
      );
    });
    lines.push(pick(SHAME_JABS, data.week)(bold(data.shame[0])));
  }

  if (data.stalled.length > 0) {
    lines.push("", "⏳ *Still waiting*");
    for (const stall of data.stalled) {
      lines.push(
        `• ${listOf(stall.waiting.map(who))} ${stall.waiting.length === 1 ? "has" : "have"} been waiting on ${bold(stall.slow)} at ${gameName(stall.gameId)} for ${recapDuration(now - stall.since)}.`,
      );
    }
    lines.push(pick(STALLED_JABS, data.week));
  }

  lines.push("", `<${baseUrl}|Make your move →>`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Sending it.
// ---------------------------------------------------------------------------

export type RecapOutcome = "sent" | "quiet" | "already_sent" | "not_configured" | "failed";

// Gathers, composes and posts the recap of the week before `now`, once per
// week: the week's row in `recaps` is claimed before posting, so a second run
// finds it taken, and given back if the post fails, so a later run can try
// again. Never throws.
export async function sendWeeklyRecap(env: Env, now = Date.now()): Promise<RecapOutcome> {
  if (!env.SLACK_WEBHOOK_URL) {
    console.log("SLACK_WEBHOOK_URL not set; skipping the weekly recap");
    return "not_configured";
  }

  // Everything that can fail before posting happens before the week is
  // claimed, so nothing but Slack itself can leave a week claimed and unsent.
  let data: RecapData;
  let text: string;
  try {
    data = await gatherRecap(env.DB, now);
    text = composeRecap(data, env.PUBLIC_BASE_URL, now);
  } catch (err) {
    console.error("weekly recap: reading or composing the week failed", err);
    return "failed";
  }
  if (isQuietWeek(data)) {
    console.log("weekly recap: nothing to report", { week: data.week });
    return "quiet";
  }

  try {
    await env.DB.prepare("INSERT INTO recaps (week, sent_at) VALUES (?, ?)")
      .bind(data.week, now)
      .run();
  } catch {
    // Taken, by an earlier run of this week's recap — or D1 is down, in
    // which case posting without a claim could post twice.
    console.log("weekly recap: already sent, or could not be claimed", { week: data.week });
    return "already_sent";
  }

  const sent = await postSlackMessage(env, text, "weekly recap", { week: data.week });
  if (sent) return "sent";

  try {
    await env.DB.prepare("DELETE FROM recaps WHERE week = ?").bind(data.week).run();
  } catch (err) {
    console.error("weekly recap: could not release the claim after a failed post", err);
  }
  return "failed";
}
