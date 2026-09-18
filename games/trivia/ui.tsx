import { useTranslation } from "react-i18next";

import type { GameUiProps } from "../../shared/protocol";
import type strings from "./locales/en.json";

declare module "i18next" {
  interface ResourceNamespaceMap {
    trivia: typeof strings;
  }
}

// Trivia UI. No game-specific countdown here — the round/reveal deadline is
// already shown once, generically, by `TurnIndicator` in `MatchPage`;
// duplicating it here would just be two clocks disagreeing by a second.
//
// Renders nothing that is not present in `view` — in particular, never the
// correct answer index or another player's pick while `phase === "answering"`,
// since the server's `view()` does not send either.
//
// The shell (`GameSurface`) provides the surrounding cabinet — this
// component renders only the round content that goes inside it.

interface AnsweringView {
  phase: "answering";
  round: number;
  totalRounds: number;
  question: string;
  choices: string[];
  yourAnswer: number | null;
  answeredCount: number;
  totalPlayers: number;
  scores: Record<string, number>;
  deadline: number | null;
}

interface RevealView {
  phase: "reveal";
  round: number;
  totalRounds: number;
  question: string;
  choices: string[];
  correctAnswer: number;
  given: Record<string, number | null>;
  scores: Record<string, number>;
  deadline: number | null;
}

interface DoneView {
  phase: "done";
  round: number;
  totalRounds: number;
  scores: Record<string, number>;
}

type TriviaView = AnsweringView | RevealView | DoneView;

// A, B, C, D … next to each choice, so a pick can be named out loud and read
// out by a screen reader without depending on position or colour.
const CHOICE_LETTERS = "ABCDEFGH";

function nameFor(players: GameUiProps["players"], id: string): string {
  return players.find((p) => p.id === id)?.nickname ?? id;
}

function RoundProgress({ round, totalRounds }: { round: number; totalRounds: number }) {
  const { t } = useTranslation("trivia");
  const fraction = totalRounds > 0 ? (round + 1) / totalRounds : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="m-0 text-xs font-bold tracking-[0.15em] text-[var(--text-muted)] uppercase">
        {t("round", { round: round + 1, total: totalRounds })}
      </p>
      <div
        className="h-2 overflow-hidden rounded-[var(--radius-pill)] bg-[var(--surface-inset)] shadow-[var(--shadow-inset)]"
        role="progressbar"
        aria-valuenow={round + 1}
        aria-valuemin={1}
        aria-valuemax={totalRounds}
      >
        <div
          className="h-full origin-left rounded-[inherit] transition-transform duration-[var(--dur-slow)] ease-[var(--ease-spring)]"
          style={{
            transform: `scaleX(${fraction})`,
            background: "linear-gradient(90deg, var(--accent), var(--party-pink))",
          }}
        />
      </div>
    </div>
  );
}

function Scoreboard({
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

function Question({ text }: { text: string }) {
  return (
    <h3 className="m-0 font-display text-xl leading-snug font-bold text-balance text-[var(--text-primary)] sm:text-2xl">
      {text}
    </h3>
  );
}

// `fill` and `ink` travel together: `--text-on-accent` only reads on the
// saturated status fills, so the neutral (unpicked) badge has to carry its
// own ink rather than inheriting the one the accent badge uses.
const NEUTRAL_BADGE = { fill: "var(--surface-3)", ink: "var(--text-secondary)" };
const ACCENT_BADGE = { fill: "var(--accent)", ink: "var(--text-on-accent)" };
const OK_BADGE = { fill: "var(--ok-fg)", ink: "var(--text-on-accent)" };
const DANGER_BADGE = { fill: "var(--danger-fg)", ink: "var(--text-on-accent)" };

function ChoiceLetter({ index, badge }: { index: number; badge: { fill: string; ink: string } }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-7 flex-none items-center justify-center rounded-[var(--radius-xs)] font-display text-sm font-bold"
      style={{ background: badge.fill, color: badge.ink }}
    >
      {CHOICE_LETTERS[index] ?? index + 1}
    </span>
  );
}

function Answering({
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

function Reveal({
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

function Done({ v, players, me }: { v: DoneView; players: GameUiProps["players"]; me: string }) {
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

export default function TriviaUi({ view, players, me, send }: GameUiProps) {
  const { t } = useTranslation("trivia");
  const v = view as TriviaView | null;

  if (!v) {
    return <p className="m-0 text-[var(--text-muted)]">{t("loading")}</p>;
  }

  if (v.phase === "done") return <Done v={v} players={players} me={me} />;
  if (v.phase === "reveal") return <Reveal v={v} players={players} me={me} />;
  return <Answering v={v} players={players} me={me} send={send} />;
}
