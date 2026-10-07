import { GAME_CATALOG } from "../games/catalog";
import { UNKNOWN_NICKNAME } from "../shared/nickname";
import type { HubMatch, MatchOutcome, MatchSummary } from "../shared/protocol";

// The hub's reads of the match index. Everything here comes from the derived
// tables, so it can lag the Durable Objects by a commit: a card may show a
// lobby that filled up a moment ago, and joining it is what finds out. Match
// truth never comes from here.

// How many cards the hub shows in any one list.
export const HUB_LIST_LIMIT = 50;

// One row per (match, player): every query here joins `match_players` to
// name each match's whole roster in the same round trip, with the names
// themselves read from the registry so a rename shows everywhere at once.
export interface MatchIndexRow {
  id: string;
  game_id: string;
  status: MatchSummary["status"];
  host_id: string | null;
  updated_at: number;
  deadline: number | null;
  visibility: string | null;
  // `win`, `draw`, `scores` or `void` once the match is over, NULL before then and
  // for a match that finished before results were indexed.
  result_kind: string | null;
  // Whether the match waits on the player asking, and whether they are among
  // its winners. Always 0 and NULL in a list of matches they are not in.
  my_waiting: number;
  my_won: number | null;
  // The row's own player, and whether the match waits on them.
  player_id: string;
  nickname: string | null;
  waiting: number;
}

// Which fields the queries below select for a MatchIndexRow, from `matches m`
// and the row's own player `p`, with `pl` their registry row.
const ROW_COLUMNS = `m.id AS id, m.game_id AS game_id, m.status AS status, m.host_id AS host_id,
            m.updated_at AS updated_at, m.deadline AS deadline, m.visibility AS visibility,
            m.result_kind AS result_kind,
            p.player_id AS player_id, pl.nickname AS nickname, p.waiting AS waiting`;

function outcomeOf(row: MatchIndexRow): MatchOutcome | null {
  if (row.status !== "done" || row.result_kind === null || row.my_won === null) return null;
  if (row.result_kind === "draw") return "draw";
  if (row.result_kind === "void") return "void";
  return row.my_won ? "won" : "lost";
}

// Folds the rows back into one summary per match, keeping the order the
// matches first appear in.
export function summarize(rows: MatchIndexRow[]): HubMatch[] {
  const summaries = new Map<string, HubMatch>();
  for (const row of rows) {
    let summary = summaries.get(row.id);
    if (!summary) {
      summary = {
        id: row.id,
        gameId: row.game_id,
        status: row.status,
        players: [],
        hostId: row.host_id ?? "",
        waiting: Boolean(row.my_waiting),
        updatedAt: row.updated_at,
        deadline: row.deadline,
        // NULL is a match indexed before visibility existed, and those were
        // all private.
        visibility: row.visibility === "public" ? "public" : "private",
        waitingOn: [],
        outcome: outcomeOf(row),
      };
      summaries.set(row.id, summary);
    }
    summary.players.push({ id: row.player_id, nickname: row.nickname ?? UNKNOWN_NICKNAME });
    if (row.waiting) summary.waitingOn.push(row.player_id);
  }
  return [...summaries.values()];
}

// Every match `playerId` is in, most recently updated first, each with its
// whole roster: one query joins `match_players` twice, once to find the
// player's own matches and once more for everyone in them, so the hub needs
// no follow-up query per match.
export async function myMatches(db: D1Database, playerId: string): Promise<HubMatch[]> {
  const { results } = await db
    .prepare(
      `SELECT ${ROW_COLUMNS}, mine.waiting AS my_waiting, mine.won AS my_won
       FROM matches m
       JOIN match_players mine ON mine.match_id = m.id AND mine.player_id = ?
       JOIN match_players p ON p.match_id = m.id
       LEFT JOIN players pl ON pl.id = p.player_id
       ORDER BY m.updated_at DESC, m.id`,
    )
    .bind(playerId)
    .all<MatchIndexRow>();
  return summarize(results);
}

// The seat count of every game that can still be joined, keyed by game id, for
// the query below. A game missing from it — shelved as coming soon, or gone
// from the registry — has no seats, so its lobbies are never listed.
function openSeats(): string {
  return JSON.stringify(
    Object.fromEntries(GAME_CATALOG.filter((g) => !g.comingSoon).map((g) => [g.id, g.maxPlayers])),
  );
}

// The public lobbies `playerId` could join right now, newest first: not
// started, not one they are already in, and with a seat left. A full lobby is
// filtered out here in SQL, not after the LIMIT, so lobbies that filled up
// and were never started cannot crowd the open ones out of the list.
export async function openMatches(db: D1Database, playerId: string): Promise<HubMatch[]> {
  const { results } = await db
    .prepare(
      `SELECT ${ROW_COLUMNS}, 0 AS my_waiting, NULL AS my_won
       FROM matches m
       JOIN match_players p ON p.match_id = m.id
       LEFT JOIN players pl ON pl.id = p.player_id
       WHERE m.id IN (
         SELECT o.id FROM matches o
         WHERE o.status = 'lobby' AND o.visibility = 'public'
           AND NOT EXISTS (
             SELECT 1 FROM match_players mine
             WHERE mine.match_id = o.id AND mine.player_id = ?
           )
           AND (SELECT COUNT(*) FROM match_players seated WHERE seated.match_id = o.id)
             < (SELECT seats.value FROM json_each(?) seats WHERE seats.key = o.game_id)
         ORDER BY o.updated_at DESC
         LIMIT ?
       )
       ORDER BY m.updated_at DESC, m.id`,
    )
    .bind(playerId, openSeats(), HUB_LIST_LIMIT)
    .all<MatchIndexRow>();
  return summarize(results);
}
