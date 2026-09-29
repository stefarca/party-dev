import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { DailyGameSummary } from "../../shared/protocol";

// How much of the day's set the player has got through: a line of text, and
// a bar with a segment per daily game that fills from the left, finished
// runs first and runs under way after them. The text says the same as the
// bar, so the bar is hidden from screen readers. `aside` goes at the end of
// the text's line.
export function DailyProgress({ games, aside }: { games: DailyGameSummary[]; aside?: ReactNode }) {
  const { t } = useTranslation();
  const done = games.filter((game) => game.mine?.status === "done").length;
  const active = games.filter((game) => game.mine?.status === "active").length;
  const allDone = games.length > 0 && done === games.length;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p
          className={`m-0 text-sm font-bold ${
            allDone ? "text-[var(--accent-on-soft)]" : "text-[var(--text-secondary)]"
          }`}
        >
          {allDone ? t("daily.allDone") : t("daily.progress", { done, total: games.length })}
        </p>
        {aside}
      </div>
      <div aria-hidden="true" className="flex gap-1">
        {games.map((game, i) => (
          <span
            key={game.gameId}
            className={`h-1.5 flex-1 rounded-[var(--radius-pill)] transition-colors duration-[var(--dur-base)] ${
              i < done
                ? "bg-[var(--accent)]"
                : i < done + active
                  ? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent)] ring-inset"
                  : "bg-[var(--surface-3)]"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
