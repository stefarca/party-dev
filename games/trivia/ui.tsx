import type { GameUiProps } from "../../shared/protocol";

// Trivia UI. No game-specific countdown here — the round/reveal
// deadline is already shown once, generically, by `TurnIndicator` in
// `MatchPage`; duplicating it here would just be two clocks disagreeing by
// a second.
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

function nameFor(players: GameUiProps["players"], id: string): string {
  return players.find((p) => p.id === id)?.nickname ?? id;
}

function RoundProgress({ round, totalRounds }: { round: number; totalRounds: number }) {
  const fraction = totalRounds > 0 ? (round + 1) / totalRounds : 0;
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 text-secondary">
        Round {round + 1} of {totalRounds}
      </p>
      <div
        className="h-[0.4rem] overflow-hidden rounded-full bg-[var(--surface-inset)] shadow-[var(--shadow-inset)]"
        role="progressbar"
        aria-valuenow={round + 1}
        aria-valuemin={1}
        aria-valuemax={totalRounds}
      >
        <div
          className="h-full origin-left rounded-[inherit] bg-accent transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)]"
          style={{ transform: `scaleX(${fraction})` }}
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
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {entries.map(([id, score]) => (
        <li
          key={id}
          className={`flex items-center justify-between gap-2 rounded-md bg-surface px-3 py-2 ${
            id === me ? "font-bold" : ""
          }`}
        >
          <span>{nameFor(players, id)}</span>
          <span>{score}</span>
        </li>
      ))}
    </ul>
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
  const locked = v.yourAnswer !== null;

  function pick(choice: number) {
    if (locked) return;
    send({ t: "answer", round: v.round, choice });
  }

  return (
    <div className="flex flex-col gap-3">
      <RoundProgress round={v.round} totalRounds={v.totalRounds} />
      <h3 className="m-0 mb-2 text-lg font-bold">{v.question}</h3>
      <div role="radiogroup" aria-label="Answer choices" className="flex flex-col gap-2">
        {v.choices.map((choice, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={v.yourAnswer === i}
            aria-pressed={v.yourAnswer === i}
            className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-md border border-[var(--border-strong)] bg-surface px-4 py-3 text-left text-base font-normal whitespace-normal text-foreground transition-[transform,background-color,border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] not-disabled:hover:-translate-y-px not-disabled:hover:border-accent disabled:cursor-not-allowed ${
              v.yourAnswer === i
                ? "animate-[party-choice-press_var(--dur-fast)_var(--ease-out)] border-accent bg-[var(--accent-soft)] font-bold"
                : ""
            }`}
            disabled={locked}
            onClick={() => pick(i)}
          >
            {v.yourAnswer === i && (
              <span className="font-bold text-accent" aria-hidden="true">
                ✓
              </span>
            )}
            {choice}
          </button>
        ))}
      </div>
      <p className="m-0 text-secondary">
        {v.answeredCount} of {v.totalPlayers} answered
        {locked ? " — your answer is locked in." : ""}
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
  return (
    <div className="flex flex-col gap-3">
      <RoundProgress round={v.round} totalRounds={v.totalRounds} />
      <p className="m-0 text-secondary">reveal</p>
      <h3 className="m-0 mb-2 text-lg font-bold">{v.question}</h3>
      <div role="list" className="flex flex-col gap-2">
        {v.choices.map((choice, i) => {
          const isCorrect = i === v.correctAnswer;
          return (
            <div
              key={i}
              role="listitem"
              className={`flex min-h-12 cursor-default items-center gap-2 rounded-md border px-4 py-3 text-base whitespace-normal ${
                isCorrect
                  ? "border-success bg-[var(--ok-soft)] font-bold"
                  : "border-[var(--border-strong)] bg-surface text-muted"
              }`}
            >
              {choice}
              {isCorrect && <span className="font-bold text-success"> correct</span>}
            </div>
          );
        })}
      </div>
      <ul className="m-0 list-disc pl-5">
        {players.map((p) => {
          const given = v.given[p.id] ?? null;
          const gotIt = given === v.correctAnswer;
          return (
            <li key={p.id}>
              {nameFor(players, p.id)}
              {p.id === me && " (you)"}: {given === null ? "no answer" : v.choices[given]}
              {gotIt ? " (+1)" : ""}
            </li>
          );
        })}
      </ul>
      <Scoreboard scores={v.scores} players={players} me={me} />
    </div>
  );
}

function Done({ v, players, me }: { v: DoneView; players: GameUiProps["players"]; me: string }) {
  const entries = Object.entries(v.scores).sort((a, b) => b[1] - a[1]);
  const topScore = entries[0]?.[1];
  const winners = entries.filter(([, score]) => score === topScore).map(([id]) => id);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="m-0 mb-2 text-lg font-bold">Final scoreboard</h3>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {entries.map(([id, score]) => (
          <li
            key={id}
            className={`flex items-center justify-between gap-2 rounded-md bg-surface px-3 py-2 ${
              winners.includes(id) ? "font-bold text-success" : ""
            }`}
          >
            <span>
              {nameFor(players, id)}
              {id === me && " (you)"}
              {winners.includes(id) && " 🏆"}
            </span>
            <span>{score}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function TriviaUi({ view, players, me, send }: GameUiProps) {
  const v = view as TriviaView | null;

  if (!v) {
    return <p className="m-0 text-muted">Loading question…</p>;
  }

  if (v.phase === "done") return <Done v={v} players={players} me={me} />;
  if (v.phase === "reveal") return <Reveal v={v} players={players} me={me} />;
  return <Answering v={v} players={players} me={me} send={send} />;
}
