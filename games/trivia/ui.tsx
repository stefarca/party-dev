import type { GameUiProps } from "../../shared/protocol";

// Trivia UI. No game-specific countdown here — the round/reveal
// deadline is already shown once, generically, by `TurnIndicator` in
// `MatchPage`; duplicating it here would just be two clocks disagreeing by
// a second.
//
// Renders nothing that is not present in `view` — in particular, never the
// correct answer index or another player's pick while `phase === "answering"`,
// since the server's `view()` does not send either.

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
    <ul className="trivia-scoreboard">
      {entries.map(([id, score]) => (
        <li key={id} className={id === me ? "trivia-score-you" : undefined}>
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
    <div className="card trivia-card">
      <p className="trivia-round">
        Round {v.round + 1} of {v.totalRounds}
      </p>
      <h3 className="trivia-question">{v.question}</h3>
      <div role="radiogroup" aria-label="Answer choices" className="trivia-choices">
        {v.choices.map((choice, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={v.yourAnswer === i}
            aria-pressed={v.yourAnswer === i}
            className={`trivia-choice${v.yourAnswer === i ? " trivia-choice-selected" : ""}`}
            disabled={locked}
            onClick={() => pick(i)}
          >
            {choice}
          </button>
        ))}
      </div>
      <p className="trivia-progress">
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
    <div className="card trivia-card">
      <p className="trivia-round">
        Round {v.round + 1} of {v.totalRounds} — reveal
      </p>
      <h3 className="trivia-question">{v.question}</h3>
      <div role="list" className="trivia-choices">
        {v.choices.map((choice, i) => {
          const isCorrect = i === v.correctAnswer;
          return (
            <div
              key={i}
              role="listitem"
              className={`trivia-choice trivia-choice-reveal${isCorrect ? " trivia-choice-correct" : ""}`}
            >
              {choice}
              {isCorrect && <span className="trivia-correct-badge"> correct</span>}
            </div>
          );
        })}
      </div>
      <ul className="trivia-picks">
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
    <div className="card trivia-card">
      <h3>Final scoreboard</h3>
      <ul className="trivia-scoreboard">
        {entries.map(([id, score]) => (
          <li key={id} className={winners.includes(id) ? "trivia-score-winner" : undefined}>
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
    return <div className="card">Loading question…</div>;
  }

  if (v.phase === "done") return <Done v={v} players={players} me={me} />;
  if (v.phase === "reveal") return <Reveal v={v} players={players} me={me} />;
  return <Answering v={v} players={players} me={me} send={send} />;
}
