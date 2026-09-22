import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import type { DailyGameMeta } from "../../games/catalog";
import type { DailyGameSummary } from "../../shared/protocol";
import { relativeTime, scoreText } from "../format";
import { useGameName, useLanguage } from "../i18n";
import { navigate } from "../router";
import { GameGlyph } from "./GameGlyph";

// One daily game on the hub: where the player's run stands today, who leads
// the day's chart, and when the board changes. Opening it goes to the game's
// daily page, which is where a run is started — never from here, so a stray
// tap on the hub cannot spend the day's only run.
export function DailyTile({
  meta,
  summary,
  endsAt,
  now,
  style,
  className = "",
}: {
  meta: DailyGameMeta;
  summary: DailyGameSummary;
  endsAt: number;
  now: number;
  style?: CSSProperties;
  // Sizing and scroll-snap for the shelf the tile is placed on. The tile
  // itself has no width of its own, so its container decides.
  className?: string;
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
      className={`party-pop group flex flex-col gap-3 rounded-[var(--radius-xl)] border-2 bg-[var(--surface-1)] p-5 no-underline transition-[transform,box-shadow,border-color] duration-[var(--dur-base)] ease-[var(--ease-spring)] hover:-translate-y-1.5 hover:border-[var(--border-accent)] hover:shadow-[var(--shadow-3),var(--glow-accent)] active:translate-y-0 active:scale-[0.98] ${
        fresh
          ? "border-[var(--border-accent)] shadow-[var(--shadow-2),var(--glow-accent)]"
          : "border-[var(--border-subtle)] shadow-[var(--shadow-2),var(--edge-highlight)]"
      } ${className}`}
    >
      <div className="flex items-start gap-3">
        <GameGlyph
          gameId={meta.id}
          className="size-14 transition-transform duration-[var(--dur-base)] ease-[var(--ease-bounce)] group-hover:-rotate-12 group-hover:scale-110"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-display text-lg font-bold text-[var(--text-primary)]">
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
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
        <span className="min-w-0 truncate">
          {leader
            ? t("daily.tile.leader", {
                name: leader.nickname,
                score: scoreText(language, leader.score, meta.format),
              })
            : t("daily.tile.noScores")}
        </span>
        <span>{t("daily.newBoard", { when: relativeTime(language, endsAt, now) })}</span>
      </div>
      <span
        aria-hidden="true"
        className="inline-flex w-fit items-center rounded-[var(--radius-pill)] px-3 py-1.5 text-sm font-bold transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] group-hover:scale-105"
        style={{ background: "var(--accent-soft)", color: "var(--accent-on-soft)" }}
      >
        {action}
      </span>
    </a>
  );
}
