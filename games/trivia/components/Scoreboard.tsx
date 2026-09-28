import { useTranslation } from "react-i18next";

import type { GameUiProps } from "../../../shared/protocol";
import { nameFor } from "../players";

export function Scoreboard({
  scores,
  players,
  me,
}: {
  scores: Record<string, number>;
  players: GameUiProps["players"];
  me: string;
}) {
  const { t } = useTranslation("trivia");
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const top = entries[0]?.[1];
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {entries.map(([id, score], i) => (
        <li
          key={id}
          className={`flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 ${
            id === me ? "font-bold" : ""
          }`}
          style={{
            background: id === me ? "var(--accent-soft)" : "var(--surface-1)",
            color: id === me ? "var(--accent-on-soft)" : "var(--text-secondary)",
          }}
        >
          <span
            aria-hidden="true"
            className="w-4 flex-none text-center text-xs text-[var(--text-muted)]"
          >
            {i + 1}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {id === me ? t("you", { name: nameFor(players, id) }) : nameFor(players, id)}
          </span>
          {score === top && score > 0 && (
            <span aria-label={t("leading")} title={t("leading")}>
              👑
            </span>
          )}
          <span className="flex-none font-mono tabular-nums">{score}</span>
        </li>
      ))}
    </ul>
  );
}
