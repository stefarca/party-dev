import { useTranslation } from "react-i18next";

import type { GameUiProps } from "../../../shared/protocol";
import { nameFor } from "../players";
import type { RevealView } from "../view";
import { ChoiceLetter, DANGER_BADGE, NEUTRAL_BADGE, OK_BADGE } from "./ChoiceLetter";
import { Question } from "./Question";
import { RoundProgress } from "./RoundProgress";
import { Scoreboard } from "./Scoreboard";

export function Reveal({
  v,
  players,
  me,
}: {
  v: RevealView;
  players: GameUiProps["players"];
  me: string;
}) {
  const { t } = useTranslation("trivia");
  const myAnswer = v.given[me] ?? null;
  const gotIt = myAnswer === v.correctAnswer;

  return (
    <div className="flex flex-col gap-5">
      <RoundProgress round={v.round} totalRounds={v.totalRounds} />
      <div
        className="flex items-center gap-3 rounded-[var(--radius-md)] px-4 py-3"
        style={{
          background: gotIt ? "var(--ok-soft)" : "var(--surface-2)",
          color: gotIt ? "var(--ok-fg)" : "var(--text-secondary)",
        }}
      >
        <span aria-hidden="true" className="text-2xl">
          {gotIt ? "🎉" : myAnswer === null ? "⏱" : "😬"}
        </span>
        <span className="font-display font-bold">
          {gotIt
            ? t("reveal.correct")
            : myAnswer === null
              ? t("reveal.timedOut")
              : t("reveal.wrong")}
        </span>
      </div>
      <Question text={v.question} />
      <div role="list" className="flex flex-col gap-2.5">
        {v.choices.map((choice, i) => {
          const isCorrect = i === v.correctAnswer;
          const wasMine = myAnswer === i;
          return (
            <div
              key={i}
              role="listitem"
              className="flex min-h-14 items-center gap-3 rounded-[var(--radius-md)] border-2 px-4 py-3 text-base whitespace-normal"
              style={{
                borderColor: isCorrect
                  ? "var(--ok-border)"
                  : wasMine
                    ? "var(--danger-border)"
                    : "var(--border-subtle)",
                background: isCorrect
                  ? "var(--ok-soft)"
                  : wasMine
                    ? "var(--danger-soft)"
                    : "var(--surface-1)",
              }}
            >
              <ChoiceLetter
                index={i}
                badge={isCorrect ? OK_BADGE : wasMine ? DANGER_BADGE : NEUTRAL_BADGE}
              />
              <span
                className="flex-1"
                style={{
                  color: isCorrect ? "var(--ok-fg)" : "var(--text-secondary)",
                  fontWeight: isCorrect ? 700 : 400,
                }}
              >
                {choice}
              </span>
              {isCorrect && (
                <span className="flex-none text-sm font-bold text-[var(--ok-fg)]">
                  {t("tag.correct")}
                </span>
              )}
              {wasMine && !isCorrect && (
                <span className="flex-none text-sm font-bold text-[var(--danger-fg)]">
                  {t("tag.yourPick")}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-[var(--text-muted)]">
        {players.map((p) => {
          const given = v.given[p.id] ?? null;
          const right = given === v.correctAnswer;
          const name = nameFor(players, p.id);
          return (
            <li key={p.id} className="flex items-center gap-2">
              <span aria-hidden="true">{right ? "✓" : "·"}</span>
              <span>
                {t(right ? "answerScored" : "answer", {
                  name: p.id === me ? t("you", { name }) : name,
                  answer: given === null ? t("noAnswer") : v.choices[given],
                })}
              </span>
            </li>
          );
        })}
      </ul>
      <Scoreboard scores={v.scores} players={players} me={me} />
    </div>
  );
}
