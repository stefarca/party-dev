import { useTranslation } from "react-i18next";

import type { GameUiProps } from "../../../shared/protocol";
import { nameFor } from "../players";
import type { DoneView } from "../view";

export function Done({
  v,
  players,
  me,
}: {
  v: DoneView;
  players: GameUiProps["players"];
  me: string;
}) {
  const { t } = useTranslation("trivia");
  const entries = Object.entries(v.scores).sort((a, b) => b[1] - a[1]);
  const topScore = entries[0]?.[1];
  const winners = entries.filter(([, score]) => score === topScore).map(([id]) => id);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-2 text-center">
        <span
          aria-hidden="true"
          className="text-5xl"
          style={{ animation: "party-celebrate 1.8s var(--ease-spring) infinite" }}
        >
          🏆
        </span>
        <h3 className="m-0 font-display text-2xl font-bold text-[var(--text-primary)]">
          {t("finalScoreboard")}
        </h3>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {entries.map(([id, score], i) => {
          const isWinner = winners.includes(id);
          return (
            <li
              key={id}
              style={{ "--pop-delay": `${i * 80}ms` } as React.CSSProperties}
              className="party-pop flex items-center gap-3 rounded-[var(--radius-md)] px-4 py-3"
            >
              <span
                aria-hidden="true"
                className="w-5 flex-none text-center font-display font-bold text-[var(--text-muted)]"
              >
                {i + 1}
              </span>
              <span
                className="min-w-0 flex-1 truncate"
                style={{ fontWeight: isWinner || id === me ? 700 : 400 }}
              >
                {id === me ? t("you", { name: nameFor(players, id) }) : nameFor(players, id)}
              </span>
              {isWinner && <span aria-label={t("winner")}>🏆</span>}
              <span className="flex-none font-mono text-lg tabular-nums">{score}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
