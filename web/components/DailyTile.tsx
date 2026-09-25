import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import type { DailyGameMeta } from "../../games/catalog";
import type { DailyGameSummary } from "../../shared/protocol";
import { scoreText } from "../format";
import { useGameName, useLanguage } from "../i18n";
import { navigate } from "../router";
import { GameGlyph } from "./GameGlyph";

// One daily game on the hub: where the player's run stands today, and who
// leads the day's chart. Opening it goes to the game's daily page, which is
// where a run is started — never from here, so a stray tap on the hub cannot
// spend the day's only run. When the board changes is the same for every
// daily game, so the section around the tiles says it once.
//
// On a phone it is a row, a list entry with a chevron that names the game
// and where the player's run stands, so every daily game fits on one screen;
// from `sm` up it is a card that also names the day's leader and spells out
// its action.
export function DailyTile({
  meta,
  summary,
  style,
}: {
  meta: DailyGameMeta;
  summary: DailyGameSummary;
  style?: CSSProperties;
}) {
  const { t } = useTranslation();
  const language = useLanguage();
  const name = useGameName()(meta.id, meta.name);
  const { mine, leader } = summary;

  let status: string;
  let action: string;
  if (!mine) {
    status = t("daily.tile.fresh");
    action = t("daily.tile.play");
  } else if (mine.status === "active") {
    status = t("daily.tile.inProgress");
    action = t("daily.tile.continue");
  } else {
    status =
      mine.score !== null
        ? t("daily.tile.scored", { score: scoreText(language, mine.score, meta.format) })
        : t("daily.result.unranked");
    if (mine.rank !== null) {
      status += ` · ${t("daily.tile.placed", { rank: mine.rank, count: summary.finished })}`;
    }
    action = t("daily.tile.seeChart");
  }
  const fresh = !mine;

  return (
    <a
      href={`/daily/${meta.id}`}
      onClick={(e) => {
        e.preventDefault();
        navigate(`/daily/${meta.id}`);
      }}
      aria-label={t("daily.tile.label", { game: name, status })}
      style={style}
      className={`party-pop group flex items-center gap-3 rounded-[var(--radius-lg)] border-2 bg-[var(--surface-1)] px-3 py-1.5 no-underline transition-[transform,box-shadow,border-color] duration-[var(--dur-base)] ease-[var(--ease-spring)] hover:-translate-y-1.5 hover:border-[var(--border-accent)] hover:shadow-[var(--shadow-3),var(--glow-accent)] active:translate-y-0 active:scale-[0.98] sm:flex-col sm:items-stretch sm:rounded-[var(--radius-xl)] sm:p-5 ${
        fresh
          ? "border-[var(--border-accent)] shadow-[var(--shadow-2),var(--glow-accent)]"
          : "border-[var(--border-subtle)] shadow-[var(--shadow-2),var(--edge-highlight)]"
      }`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <GameGlyph
          gameId={meta.id}
          className="size-10 transition-transform duration-[var(--dur-base)] ease-[var(--ease-bounce)] group-hover:-rotate-12 group-hover:scale-110 sm:size-14"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:gap-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-display text-base font-bold text-[var(--text-primary)] sm:text-lg">
              {name}
            </span>
            <span
              className="flex-none rounded-[var(--radius-pill)] px-2 py-0.5 text-xs font-bold"
              style={{ background: "var(--party-pink-soft)", color: "var(--party-pink-on-soft)" }}
            >
              {t("daily.chip")}
            </span>
          </span>
          <span className="text-sm text-[var(--text-secondary)]">{status}</span>
          <span className="hidden truncate text-xs text-[var(--text-muted)] sm:block">
            {leader
              ? t("daily.tile.leader", {
                  name: leader.nickname,
                  score: scoreText(language, leader.score, meta.format),
                })
              : t("daily.tile.noScores")}
          </span>
        </div>
      </div>
      <span
        aria-hidden="true"
        className="hidden w-fit items-center rounded-[var(--radius-pill)] px-3 py-1.5 text-sm font-bold transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] group-hover:scale-105 sm:inline-flex"
        style={{ background: "var(--accent-soft)", color: "var(--accent-on-soft)" }}
      >
        {action}
      </span>
      <svg
        viewBox="0 0 24 24"
        className="size-5 flex-none text-[var(--text-muted)] sm:hidden"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m9 6 6 6-6 6" />
      </svg>
    </a>
  );
}
