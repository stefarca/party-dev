import { Button } from "@heroui/react";
import { useTranslation } from "react-i18next";

import type { DailyGameMeta } from "../../games/catalog";
import { addDays } from "../../shared/daily";
import type { DailyChart as Chart, DailyChartEntry } from "../../shared/protocol";
import { errorText } from "../errors";
import { dayLabel, scoreText } from "../format";
import { useLanguage } from "../i18n";
import { PlayerAvatar } from "./PlayerAvatar";
import { EmptyState, Notice, Skeleton } from "./states";

// A daily game's chart for one day, with a stepper back through earlier days.
// Strictly presentational: the page owns which day is shown and the fetch.
// Knows no game's rules — each run's extra line is the game's own string,
// looked up in the game's namespace the way the match history looks up a
// move's.

// `t` is typed against the app's `common` strings; a chart line's key and
// namespace are the game's, known only at runtime.
type GameT = (key: string, options: Record<string, unknown>) => string;

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

function Rank({ rank }: { rank: number | null }) {
  const { t } = useTranslation();
  if (rank === null) {
    return <span className="text-[var(--text-muted)]">–</span>;
  }
  const medal = MEDALS[rank];
  return medal ? (
    <>
      <span aria-hidden="true" className="text-xl">
        {medal}
      </span>
      <span className="sr-only">{t("daily.chart.rank", { rank })}</span>
    </>
  ) : (
    <span>{t("daily.chart.rank", { rank })}</span>
  );
}

function Row({
  entry,
  meta,
  mine,
  tGame,
}: {
  entry: DailyChartEntry;
  meta: DailyGameMeta;
  mine: boolean;
  tGame: GameT;
}) {
  const { t } = useTranslation();
  const language = useLanguage();
  return (
    <li
      className={`flex items-center gap-3 rounded-[var(--radius-md)] px-2.5 py-2 ${
        mine
          ? "bg-[var(--accent-soft)] ring-2 ring-[var(--border-accent)]"
          : "bg-[var(--surface-2)]"
      }`}
    >
      <span className="flex w-8 flex-none justify-center font-display text-sm font-bold tabular-nums text-[var(--text-secondary)]">
        <Rank rank={entry.rank} />
      </span>
      <PlayerAvatar id={entry.playerId} nickname={entry.nickname} size="sm" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-bold text-[var(--text-primary)]">
            {entry.nickname}
          </span>
          {mine && (
            <span
              className="flex-none rounded-[var(--radius-pill)] px-1.5 py-px text-[0.65rem] font-bold"
              style={{ background: "var(--accent-soft)", color: "var(--accent-on-soft)" }}
            >
              {t("daily.chart.you")}
            </span>
          )}
        </span>
        {entry.detail && (
          <span className="truncate text-xs text-[var(--text-muted)]">
            {tGame(entry.detail.key, { ...entry.detail.values, defaultValue: "" })}
          </span>
        )}
      </span>
      <span className="flex-none font-display text-base font-bold tabular-nums text-[var(--text-primary)]">
        {entry.score !== null ? (
          scoreText(language, entry.score, meta.format)
        ) : (
          <span className="text-xs font-semibold text-[var(--text-muted)]">
            {t("daily.chart.unranked")}
          </span>
        )}
      </span>
    </li>
  );
}

export function DailyChart({
  meta,
  day,
  today,
  chart,
  error,
  myPlayerId,
  onDayChange,
  onRetry,
}: {
  meta: DailyGameMeta;
  day: string;
  today: string;
  chart: Chart | null;
  error: unknown;
  myPlayerId: string;
  onDayChange: (day: string) => void;
  onRetry: () => void;
}) {
  const { t, i18n } = useTranslation();
  const language = useLanguage();
  const getFixedT = i18n.getFixedT as unknown as (lng: null, ns: string) => GameT;
  const tGame = getFixedT(null, meta.id);
  const label = dayLabel(language, day, "short");
  // The caller's own run, when it placed below the listed page.
  const beyond =
    chart?.mine &&
    chart.mine.status === "done" &&
    !chart.entries.some((e) => e.playerId === myPlayerId)
      ? chart.mine
      : null;

  let body;
  if (error) {
    body = (
      <Notice tone="danger" action={{ label: t("retry"), onClick: onRetry }}>
        {errorText(t, error, t("daily.chart.loadFailed"))}
      </Notice>
    );
  } else if (!chart) {
    body = (
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton height="3rem" rounded="md" />
        <Skeleton height="3rem" rounded="md" />
        <Skeleton height="3rem" rounded="md" />
      </div>
    );
  } else if (chart.entries.length === 0) {
    body = (
      <EmptyState glyph="🏁">
        {day === today ? t("daily.chart.empty") : t("daily.chart.emptyPast")}
      </EmptyState>
    );
  } else {
    body = (
      <ol
        aria-label={t("daily.chart.label", { day: dayLabel(language, day) })}
        className="m-0 flex list-none flex-col gap-1.5 p-0"
      >
        {chart.entries.map((entry) => (
          <Row
            key={entry.playerId}
            entry={entry}
            meta={meta}
            mine={entry.playerId === myPlayerId}
            tGame={tGame}
          />
        ))}
        {beyond && (
          <>
            <li aria-hidden="true" className="text-center text-[var(--text-muted)]">
              ⋯
            </li>
            <Row entry={beyond} meta={meta} mine tGame={tGame} />
          </>
        )}
      </ol>
    );
  }

  return (
    <section className="party-pop flex flex-col gap-4 rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-5 shadow-[var(--shadow-2),var(--edge-highlight)]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 font-display text-lg font-bold text-[var(--text-primary)]">
          {t("daily.chart.title")}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label={t("daily.chart.previous")}
            onPress={() => onDayChange(addDays(day, -1))}
          >
            <span aria-hidden="true" className="text-xl leading-none">
              ‹
            </span>
          </Button>
          <span className="min-w-24 text-center text-sm font-bold text-[var(--text-secondary)]">
            {label}
          </span>
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label={t("daily.chart.next")}
            isDisabled={day >= today}
            onPress={() => onDayChange(addDays(day, 1))}
          >
            <span aria-hidden="true" className="text-xl leading-none">
              ›
            </span>
          </Button>
        </div>
      </div>
      {body}
      {chart && chart.playing > 0 && (
        <p className="m-0 text-xs text-[var(--text-muted)]">
          {t("daily.chart.playing", { count: chart.playing })}
        </p>
      )}
    </section>
  );
}
