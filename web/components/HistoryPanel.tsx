import { Disclosure } from "@heroui/react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import type { MatchEvent, MatchEventPayload, PlayerId, PlayerInfo } from "../../shared/protocol";
import { useLanguage } from "../i18n";
import { PlayerAvatar } from "./PlayerAvatar";

// A collapsible, plain-language view of the event log. Newest first, and
// still ignorant of any game's rules — a move's wording comes from the
// game's own `describeAction` (shared/game.ts), resolved here against that
// game's i18n namespace. Collapsed by default (react-aria's own
// uncontrolled disclosure state, not anything MatchPage passes down) so
// mounting a fresh event never re-opens or re-collapses it.

// `t` is typed against the app's own `common` strings (see web/i18n.ts).
// A move's key *and* its namespace are a game's, both known only at
// runtime, so the per-game lookup goes through this deliberately loose
// signature instead.
type GameT = (key: string, options: Record<string, unknown>) => string;

interface Line {
  text: string;
  glyph: string;
  // The player a row is about, when there is one — the row shows their
  // avatar instead of a glyph, so a long history is scannable by colour.
  actor: PlayerId | null;
}

// Events name players by id only, so a rename relabels the whole history. The
// snapshot's roster is named from the registry every time it is sent.
function nameFor(players: PlayerInfo[], id: PlayerId): string {
  return players.find((p) => p.id === id)?.nickname ?? id;
}

// One event, as a sentence. A move's own string comes from `tGame`, fixed
// to `games/<gameId>/locales/<lng>.json`; everything else is engine-level
// and lives in `common`.
function lineFor(
  t: TFunction,
  tGame: GameT,
  players: PlayerInfo[],
  payload: MatchEventPayload,
): Line {
  switch (payload.type) {
    case "player_joined":
      return {
        text: t("history.joined", { name: nameFor(players, payload.id) }),
        glyph: "👋",
        actor: payload.id,
      };

    case "match_started":
      return { text: t("history.started"), glyph: "🎲", actor: null };

    case "action": {
      const name = nameFor(players, payload.by);
      if (!("describe" in payload)) {
        // A game that ships no `describeAction`. Its raw action is in the
        // payload, but printing JSON is what this panel exists to stop —
        // say that a move happened and leave the board to show what it was.
        return { text: t("history.move", { name }), glyph: "•", actor: payload.by };
      }
      const { key, values } = payload.describe;
      return {
        // `defaultValue` covers a game whose module describes a move its
        // locale file has no wording for yet — that is a missing string, not
        // a reason to show the player a raw key.
        text: tGame(key, { ...values, name, defaultValue: t("history.move", { name }) }),
        glyph: "•",
        actor: payload.by,
      };
    }

    case "deadline_resolved":
      return { text: t("history.timedOut"), glyph: "⏱", actor: null };

    case "match_finished": {
      const result = payload.result;
      if (result.kind === "draw") return { text: t("history.draw"), glyph: "🏁", actor: null };
      if (result.kind === "win") {
        if (result.winners.length === 0) {
          return { text: t("history.noWinner"), glyph: "🏁", actor: null };
        }
        return {
          text: t("history.won", {
            count: result.winners.length,
            names: result.winners.map((id) => nameFor(players, id)).join(", "),
          }),
          glyph: "🏆",
          // Only a lone winner gets an avatar; two of them would need two.
          actor: result.winners.length === 1 ? result.winners[0] : null,
        };
      }
      const entries = Object.entries(result.scores).sort((a, b) => b[1] - a[1]);
      return {
        text: t("history.scores", {
          scores: entries.map(([id, score]) => `${nameFor(players, id)} ${score}`).join(", "),
        }),
        glyph: "🏆",
        actor: null,
      };
    }
  }
}

export function HistoryPanel({
  events,
  players,
  gameId,
}: {
  events: MatchEvent[];
  players: PlayerInfo[];
  gameId: string;
}) {
  const { t, i18n } = useTranslation();
  const language = useLanguage();
  // Fixed to this game's namespace, so a description's key is looked up
  // next to the rest of that game's strings.
  const getFixedT = i18n.getFixedT as unknown as (lng: null, ns: string) => GameT;
  const tGame = getFixedT(null, gameId);
  const newestFirst = [...events].reverse();

  return (
    <Disclosure className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-surface/70 shadow-[var(--edge-highlight),var(--shadow-1)]">
      <Disclosure.Heading>
        <Disclosure.Trigger className="flex w-full items-center gap-2 px-5 py-3 text-left font-display text-sm font-semibold text-[var(--text-secondary)]">
          {t("history.title")}
          <span className="inline-flex min-w-6 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--surface-3)] px-2 py-0.5 text-xs font-bold text-[var(--text-muted)]">
            {events.length}
          </span>
          <Disclosure.Indicator />
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="px-5 pb-4">
          {newestFirst.length === 0 ? (
            <p className="m-0 text-sm text-[var(--text-muted)]">{t("history.empty")}</p>
          ) : (
            <ol
              aria-label={t("history.title")}
              className="m-0 flex max-h-64 list-none flex-col gap-1 overflow-y-auto p-0"
            >
              {newestFirst.map((event) => {
                const line = lineFor(t, tGame, players, event.payload);
                return (
                  <li
                    key={event.seq}
                    className="flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 odd:bg-[var(--surface-2)]/60"
                  >
                    {line.actor ? (
                      <PlayerAvatar
                        id={line.actor}
                        nickname={nameFor(players, line.actor)}
                        size="sm"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex size-6 flex-none items-center justify-center text-sm"
                      >
                        {line.glyph}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 text-sm text-[var(--text-secondary)]">
                      {line.text}
                    </span>
                    <time
                      dateTime={new Date(event.ts).toISOString()}
                      className="flex-none text-xs tabular-nums text-[var(--text-muted)]"
                    >
                      {new Date(event.ts).toLocaleTimeString(language, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </li>
                );
              })}
            </ol>
          )}
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  );
}
