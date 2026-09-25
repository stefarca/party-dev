import { useTranslation } from "react-i18next";

import type { GameUiProps } from "../../../shared/protocol";
import type { AnsweringView } from "../view";
import { ACCENT_BADGE, ChoiceLetter, NEUTRAL_BADGE } from "./ChoiceLetter";
import { Question } from "./Question";
import { RoundProgress } from "./RoundProgress";
import { Scoreboard } from "./Scoreboard";

export function Answering({
  v,
  players,
  me,
  send,
}: {
  v: AnsweringView;
  players: GameUiProps["players"];
  me: string;
  send: (a: unknown) => void;
}) {
  const { t } = useTranslation("trivia");
  const locked = v.yourAnswer !== null;

  function pick(choice: number) {
    if (locked) return;
    send({ t: "answer", round: v.round, choice });
  }

  return (
    <div className="flex flex-col gap-5">
      <RoundProgress round={v.round} totalRounds={v.totalRounds} />
      <Question text={v.question} />
      <div role="radiogroup" aria-label={t("choices")} className="flex flex-col gap-2.5">
        {v.choices.map((choice, i) => {
          const picked = v.yourAnswer === i;
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={picked}
              style={
                {
                  "--pop-delay": `${i * 70}ms`,
                  background: picked ? "var(--accent-soft)" : "var(--surface-1)",
                } as React.CSSProperties
              }
              className={`party-pop flex min-h-14 cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border-2 px-4 py-3 text-left text-base whitespace-normal transition-[transform,border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-spring)] disabled:cursor-not-allowed not-disabled:hover:-translate-y-0.5 not-disabled:hover:border-[var(--border-accent)] not-disabled:hover:shadow-[var(--shadow-2)] not-disabled:active:scale-[0.98] ${
                picked
                  ? "animate-[party-choice-press_var(--dur-base)_var(--ease-bounce)] border-[var(--border-accent)] font-bold"
                  : "border-[var(--border-subtle)]"
              }`}
              disabled={locked}
              onClick={() => pick(i)}
            >
              <ChoiceLetter index={i} badge={picked ? ACCENT_BADGE : NEUTRAL_BADGE} />
              <span className="flex-1 text-[var(--text-primary)]">{choice}</span>
              {picked && (
                <span aria-hidden="true" className="flex-none text-[var(--accent-on-soft)]">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="m-0 text-sm text-[var(--text-secondary)]">
        {t(locked ? "answeredLocked" : "answered", {
          count: v.answeredCount,
          total: v.totalPlayers,
        })}
      </p>
      <Scoreboard scores={v.scores} players={players} me={me} />
    </div>
  );
}
