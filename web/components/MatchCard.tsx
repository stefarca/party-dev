import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { GameMeta } from "../../games/catalog";
import type { HubMatch, MatchOutcome } from "../../shared/protocol";
import { relativeTime } from "../format";
import { useLanguage } from "../i18n";
import { navigate } from "../router";
import { GameGlyph } from "./GameGlyph";
import { HUB_ROW, HUB_ROW_BADGE, HubRowAction, hubRowBody } from "./HubList";

// Which of the hub's lists a match is in, which decides what its row leads
// with: the move to make, whose move it is instead, how it ended, or the seat
// on offer.
export type MatchListKind = "yourTurn" | "open" | "waiting" | "finished";

// How close a deadline has to be before a row warns about it.
const URGENT_MS = 3 * 60 * 60 * 1000;

const OUTCOME_STYLE: Record<MatchOutcome | "unknown", { fill: string; ink: string }> = {
  won: { fill: "var(--ok-soft)", ink: "var(--ok-fg)" },
  lost: { fill: "var(--surface-3)", ink: "var(--text-secondary)" },
  draw: { fill: "var(--warn-soft)", ink: "var(--warn-fg)" },
  unknown: { fill: "var(--surface-3)", ink: "var(--text-muted)" },
};

// One match on the hub, as a row of a `HubList`: the game, who it is with
// (or, while it waits on someone else, who), and on the right what opening it
// is for. The list it sits in already says whose turn it is, so the row says
// only what that list leaves out. `divided` says whether a phone draws a line
// between it and the row above.
export function MatchCard({
  match,
  game,
  gameName,
  kind,
  myPlayerId,
  divided,
  style,
}: {
  match: HubMatch;
  game: GameMeta | undefined;
  gameName: string;
  kind: MatchListKind;
  myPlayerId: string;
  divided: boolean;
  style?: CSSProperties;
}) {
  const { t } = useTranslation();
  const language = useLanguage();
  const now = Date.now();
  const names = (ids: string[]) =>
    new Intl.ListFormat(language, { style: "long", type: "conjunction" }).format(
      match.players.filter((p) => ids.includes(p.id)).map((p) => p.nickname),
    );
  const others = match.players.filter((p) => p.id !== myPlayerId).map((p) => p.id);
  const waitingOnOthers = match.waitingOn.filter((id) => id !== myPlayerId);

  // The line under the game's name.
  let context: string;
  if (kind === "waiting" && match.status === "active" && waitingOnOthers.length > 0) {
    context = t("card.turnOf", { names: names(waitingOnOthers) });
  } else if (others.length > 0) {
    context = names(others);
  } else {
    context = t("card.waitingForOthers");
  }
  let due: ReactNode = null;
  if (match.deadline !== null && kind !== "finished") {
    // Only a deadline close enough to act on is told in the warning colour.
    const urgent = match.deadline - now < URGENT_MS;
    due = (
      <span className={urgent ? "font-bold text-[var(--warn-fg)]" : undefined}>
        {match.deadline <= now
          ? t("card.deadlinePassed")
          : t("card.due", { when: relativeTime(language, match.deadline, now) })}
      </span>
    );
  }

  return (
    <a
      href={`/m/${match.id}`}
      style={style}
      onClick={(e) => {
        e.preventDefault();
        navigate(`/m/${match.id}`);
      }}
      className={HUB_ROW}
    >
      <GameGlyph gameId={match.gameId} className={HUB_ROW_BADGE} />
      <span className={hubRowBody(divided)}>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-display text-base font-bold text-[var(--text-primary)] sm:text-lg">
            {gameName}
          </span>
          <span className="truncate text-xs text-[var(--text-muted)] sm:text-sm">
            {context}
            {due && (
              <>
                <span aria-hidden="true"> · </span>
                {due}
              </>
            )}
          </span>
        </span>
        <Trailing match={match} game={game} kind={kind} now={now} />
      </span>
    </a>
  );
}

// The right-hand column: the move to make or the seat to take, and otherwise
// where the match stands and when it last moved.
function Trailing({
  match,
  game,
  kind,
  now,
}: {
  match: HubMatch;
  game: GameMeta | undefined;
  kind: MatchListKind;
  now: number;
}) {
  const { t } = useTranslation();
  const language = useLanguage();

  if (kind === "yourTurn") return <HubRowAction strong>{t("card.play")}</HubRowAction>;
  if (kind === "open") return <HubRowAction strong={false}>{t("card.join")}</HubRowAction>;

  const when = (
    <span className="text-xs whitespace-nowrap text-[var(--text-muted)]">
      {relativeTime(language, match.updatedAt, now)}
    </span>
  );
  if (kind === "finished") {
    const outcome = match.outcome ?? "unknown";
    const { fill, ink } = OUTCOME_STYLE[outcome];
    return (
      <span className="flex flex-none flex-col items-end gap-1">
        <span
          className="rounded-[var(--radius-pill)] px-2.5 py-0.5 text-xs font-bold"
          style={{ background: fill, color: ink }}
        >
          {t(`card.outcome.${outcome}`)}
        </span>
        {when}
      </span>
    );
  }

  // Under way, or a lobby of the player's own still filling up.
  if (match.status === "lobby" && game) {
    return (
      <span className="flex flex-none flex-col items-end gap-1">
        <span className="rounded-[var(--radius-pill)] bg-[var(--surface-3)] px-2.5 py-0.5 text-xs font-bold text-[var(--text-secondary)] tabular-nums">
          {t("card.seats", { taken: match.players.length, max: game.maxPlayers })}
        </span>
        {when}
      </span>
    );
  }
  return when;
}
