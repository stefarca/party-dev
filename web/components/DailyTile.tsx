import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import type { DailyGameMeta } from "../../games/catalog";
import type { DailyGameSummary } from "../../shared/protocol";
import { scoreText } from "../format";
import { useGameName, useLanguage } from "../i18n";
import { navigate } from "../router";
import { MEDALS } from "./DailyChart";
import { GameGlyph } from "./GameGlyph";
import { HUB_ROW, HUB_ROW_BADGE, HubRowAction, hubRowBody } from "./HubList";

// `t` is typed against the app's `common` strings; a run's detail line is the
// game's own, in a namespace known only at runtime.
type GameT = (key: string, options: Record<string, unknown>) => string;

// One daily game on the hub. Opening it goes to the game's daily page, which
// is where a run is started — never from here, so a stray tap on the hub
// cannot spend the day's only run. When the board changes is the same for
// every daily game, so the section around the tiles says it once — and so
// does the fact that they are daily games, which is why no tile says so.
//
// It reads like a store listing: the game, one line of context, and on the
// right what there is to do (play, continue) or, once the run is over, how it
// went. The context line is the day's leader, which is what makes a player
// want to beat it, except where the run itself has more to say: a run with
// no score says how far it got, and a run on top says so.
//
// It is a row of a `HubList`, so `divided` says whether a phone draws a line
// between it and the row above.
export function DailyTile({
  meta,
  summary,
  divided,
  style,
}: {
  meta: DailyGameMeta;
  summary: DailyGameSummary;
  divided: boolean;
  style?: CSSProperties;
}) {
  const { t, i18n } = useTranslation();
  const language = useLanguage();
  const name = useGameName()(meta.id, meta.name);
  const { mine, leader } = summary;
  const done = mine?.status === "done";

  // Said in full to screen readers, where the right-hand column is folded in.
  let status: string;
  if (!mine) status = t("daily.tile.fresh");
  else if (mine.status === "active") status = t("daily.tile.inProgress");
  else {
    status =
      mine.score !== null
        ? t("daily.tile.scored", { score: scoreText(language, mine.score, meta.format) })
        : t("daily.tile.unranked");
    if (mine.rank !== null) {
      status += ` · ${t("daily.tile.placed", { rank: mine.rank, count: summary.finished })}`;
    }
  }

  let context: string;
  let highlight = false;
  if (done && mine.score === null && mine.detail) {
    const getFixedT = i18n.getFixedT as unknown as (lng: null, ns: string) => GameT;
    context = getFixedT(null, meta.id)(mine.detail.key, {
      ...mine.detail.values,
      defaultValue: t("daily.tile.unranked"),
    });
  } else if (done && mine.rank === 1) {
    context = t("daily.tile.youLead");
    highlight = true;
  } else if (leader) {
    context = t("daily.tile.leader", {
      name: leader.nickname,
      score: scoreText(language, leader.score, meta.format),
    });
  } else {
    context = t("daily.tile.noScores");
  }

  return (
    <a
      href={`/daily/${meta.id}`}
      onClick={(e) => {
        e.preventDefault();
        navigate(`/daily/${meta.id}`);
      }}
      aria-label={t("daily.tile.label", { game: name, status, line: context })}
      style={style}
      className={HUB_ROW}
    >
      <GameGlyph gameId={meta.id} className={HUB_ROW_BADGE} />
      <span className={hubRowBody(divided)}>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-display text-base font-bold text-[var(--text-primary)] sm:text-lg">
            {name}
          </span>
          <span
            className={`truncate text-xs sm:text-sm ${
              highlight ? "font-bold text-[var(--accent-on-soft)]" : "text-[var(--text-muted)]"
            }`}
          >
            {context}
          </span>
        </span>
        <Outcome meta={meta} summary={summary} />
      </span>
    </a>
  );
}

// The right-hand column: what to do next, or how the run went.
function Outcome({ meta, summary }: { meta: DailyGameMeta; summary: DailyGameSummary }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { mine } = summary;

  if (!mine || mine.status === "active") {
    return (
      <HubRowAction strong={!mine}>
        {mine ? t("daily.tile.continue") : t("daily.tile.play")}
      </HubRowAction>
    );
  }

  // No score to show: a dash where it would go, as on the chart. The line
  // beside it says how far the run got.
  if (mine.score === null) {
    return (
      <span
        aria-hidden="true"
        className="flex-none font-display text-base font-bold text-[var(--text-muted)] sm:text-lg"
      >
        –
      </span>
    );
  }

  const medal = mine.rank !== null ? MEDALS[mine.rank] : undefined;
  return (
    <span aria-hidden="true" className="flex flex-none flex-col items-end">
      <span className="font-display text-base font-bold text-[var(--text-primary)] tabular-nums sm:text-lg">
        {scoreText(language, mine.score, meta.format)}
      </span>
      {mine.rank !== null && (
        <span className="text-xs whitespace-nowrap text-[var(--text-muted)] tabular-nums">
          {medal && <span className="mr-1">{medal}</span>}
          {t("daily.tile.placed", { rank: mine.rank, count: summary.finished })}
        </span>
      )}
    </span>
  );
}
