import { z } from "zod";

import { shuffle } from "../../shared/prng";
import type { GameModule, Result } from "../../shared/game";
import type { PlayerId } from "../../shared/protocol";
import { QUESTIONS } from "./questions";
import type { Question } from "./questions";

// Trivia — the second real game, proving the "simultaneous + deadline" phase
// type from PLAN.md §4 end to end (plan 07). Everyone answers the same
// question at once; the round resolves the instant every player has
// submitted, or when the deadline alarm fires, whichever comes first.
//
// This game is also the reason `view()` exists (§5 rule 2): full state
// carries the correct answer index and every player's own submission —
// broadcasting it raw would hand every player the answer key in devtools.
// And it is the reason `onDeadline` must be idempotent (§5 rule 4, §10.6):
// alarms are at-least-once with retries, and a double-resolve would score a
// round twice.

export const ROUNDS = 5;

// PLAN.md §5 "a chess turn auto-passes after 24h" — the binding deadline
// default for any deadline-driven phase, not just chess turns. A round left
// unanswered still resolves (everyone who didn't answer scores 0) after this
// long, so the game survives a meeting.
export const ROUND_TIMEOUT_MS = 24 * 60 * 60 * 1000;

// The reveal window: how long `phase: "reveal"` (correct answer + everyone's
// picks shown) lasts before the alarm advances to the next round. Short by
// design — this is the phase transition that proves the alarm fires twice
// per round, not something players are meant to sit through for long.
export const REVEAL_MS = 8000;

const QUESTION_BY_ID = new Map<string, Question>(QUESTIONS.map((q) => [q.id, q]));

export interface RevealInfo {
  questionId: string;
  answer: number;
  given: Record<PlayerId, number | null>;
}

export interface TriviaState {
  players: PlayerId[];
  questionIds: string[];
  round: number;
  roundStartedAt: number;
  revealStartedAt: number;
  answers: Record<PlayerId, number>; // current round only
  revealed: RevealInfo | null;
  scores: Record<PlayerId, number>;
  phase: "answering" | "reveal" | "done";
  rng: number;
}

export type AnswerAction = { t: "answer"; round: number; choice: number };

export const AnswerActionSchema: z.ZodType<AnswerAction> = z.object({
  t: z.literal("answer"),
  round: z.number().int(),
  choice: z.number().int().min(0),
});

function questionAt(state: TriviaState, round: number): Question {
  const id = state.questionIds[round];
  const question = QUESTION_BY_ID.get(id);
  if (!question) throw new Error(`unknown question id "${id}"`);
  return question;
}

export function init(players: PlayerId[], seed: number): TriviaState {
  if (players.length < 2) {
    throw new Error("trivia requires at least 2 players");
  }
  // §5 rule 3: which questions, and in what order, go through the seeded
  // PRNG, never Math.random() — the advanced rng state is stored so nothing
  // downstream needs `Math.random()` either.
  const ids = QUESTIONS.map((q) => q.id);
  const [shuffled, rng] = shuffle(ids, seed);
  const questionIds = shuffled.slice(0, Math.min(ROUNDS, shuffled.length));

  const scores: Record<PlayerId, number> = {};
  for (const p of players) scores[p] = 0;

  return {
    players: players.slice(),
    questionIds,
    round: 0,
    // `init()` has no `now` (PLAN.md §5's signature is `init(players,
    // seed)`), so it cannot stamp a real wall-clock start for round 0 — left
    // at the `0` sentinel until the first `reduce()` call (which does get a
    // real `now`) sets it for real. Same pattern as connect4's
    // `turnStartedAt` (plan 06).
    roundStartedAt: 0,
    revealStartedAt: 0,
    answers: {},
    revealed: null,
    scores,
    phase: "answering",
    rng,
  };
}

// Scores the just-finished question: +1 for a correct answer, 0 for a wrong
// one or a non-answer. Returns the updated scoreboard plus the "who answered
// what" record that `view()` is allowed to reveal only from `reveal` on.
function scoreQuestion(
  state: TriviaState,
  question: Question
): { scores: Record<PlayerId, number>; given: Record<PlayerId, number | null> } {
  const scores = { ...state.scores };
  const given: Record<PlayerId, number | null> = {};
  for (const p of state.players) {
    const choice = Object.prototype.hasOwnProperty.call(state.answers, p) ? state.answers[p] : null;
    given[p] = choice;
    if (choice === question.answer) {
      scores[p] = (scores[p] ?? 0) + 1;
    }
  }
  return { scores, given };
}

// A single shared resolution function used by BOTH `reduce` (the
// all-submitted path) and `onDeadline` (the timeout path) so the two cannot
// diverge (this plan's entire point). Moves `answering` -> `reveal`; the
// alarm-driven `advanceAfterReveal` below handles `reveal` -> next round /
// `done`.
function resolveRound(state: TriviaState, now: number): TriviaState {
  const question = questionAt(state, state.round);
  const { scores, given } = scoreQuestion(state, question);
  return {
    ...state,
    phase: "reveal",
    revealed: { questionId: question.id, answer: question.answer, given },
    scores,
    revealStartedAt: now,
  };
}

// `reveal` -> next round (freshly `answering`) or `done` once every question
// has been played.
function advanceAfterReveal(state: TriviaState, now: number): TriviaState {
  const nextRound = state.round + 1;
  if (nextRound >= state.questionIds.length) {
    return { ...state, phase: "done", answers: {}, revealed: null };
  }
  return {
    ...state,
    round: nextRound,
    phase: "answering",
    answers: {},
    revealed: null,
    roundStartedAt: now,
  };
}

export function reduce(state: TriviaState, action: AnswerAction, by: PlayerId, now: number): TriviaState {
  if (state.phase !== "answering") {
    throw new Error("not accepting answers right now");
  }
  if (action.round !== state.round) {
    throw new Error("that round has already been resolved");
  }
  if (!state.players.includes(by)) {
    throw new Error("not a player in this match");
  }
  if (Object.prototype.hasOwnProperty.call(state.answers, by)) {
    throw new Error("already answered this round");
  }
  const question = questionAt(state, state.round);
  if (action.choice >= question.choices.length) {
    throw new Error("choice out of range");
  }

  const stamped: TriviaState = {
    ...state,
    // Same `0`-sentinel handling as `init()`'s comment above: only round 0's
    // very first answer needs to stamp a real start time; every later
    // round's `roundStartedAt` was already set for real by
    // `advanceAfterReveal`.
    roundStartedAt: state.roundStartedAt === 0 ? now : state.roundStartedAt,
    answers: { ...state.answers, [by]: action.choice },
  };

  if (Object.keys(stamped.answers).length >= stamped.players.length) {
    return resolveRound(stamped, now);
  }
  return stamped;
}

export function view(state: TriviaState, forPlayer: PlayerId): unknown {
  const totalRounds = state.questionIds.length;
  const scores = { ...state.scores };

  if (state.phase === "done") {
    return { phase: "done" as const, round: state.round, totalRounds, scores };
  }

  const question = questionAt(state, state.round);

  if (state.phase === "reveal" && state.revealed) {
    return {
      phase: "reveal" as const,
      round: state.round,
      totalRounds,
      question: question.q,
      choices: question.choices.slice(),
      correctAnswer: state.revealed.answer,
      given: { ...state.revealed.given },
      scores,
      deadline: deadline(state),
    };
  }

  // "answering" — never include the correct answer index or any other
  // player's choice (§5 rule 2); only this player's own submission (if any)
  // and the *count* of players who have answered.
  const yourAnswer = Object.prototype.hasOwnProperty.call(state.answers, forPlayer)
    ? state.answers[forPlayer]
    : null;
  return {
    phase: "answering" as const,
    round: state.round,
    totalRounds,
    question: question.q,
    choices: question.choices.slice(),
    yourAnswer,
    answeredCount: Object.keys(state.answers).length,
    totalPlayers: state.players.length,
    scores,
    deadline: deadline(state),
  };
}

export function waitingOn(state: TriviaState): PlayerId[] {
  if (state.phase !== "answering") return [];
  return state.players.filter((p) => !Object.prototype.hasOwnProperty.call(state.answers, p));
}

export function deadline(state: TriviaState): number | null {
  if (state.phase === "answering") {
    // See init()'s comment: `0` means round 0 has not had its first answer
    // yet, so there is nothing to time out against.
    if (state.roundStartedAt === 0) return null;
    return state.roundStartedAt + ROUND_TIMEOUT_MS;
  }
  if (state.phase === "reveal") {
    return state.revealStartedAt + REVEAL_MS;
  }
  return null;
}

export function onDeadline(state: TriviaState, now: number): TriviaState {
  // Idempotent (§5 rule 4, §10.6), keyed on `deadline(state)`: resolving a
  // round (or advancing past a reveal) always moves the deadline forward —
  // `resolveRound` sets `revealStartedAt = now` (pushing the deadline out by
  // `REVEAL_MS`) and `advanceAfterReveal` sets a fresh `roundStartedAt` (or
  // returns `null` once done). So re-running `onDeadline` with the same (or
  // an earlier) `now` on either the original state or its own output is a
  // guaranteed no-op: whatever the alarm was for has already resolved and
  // the new deadline has not been reached yet.
  const due = deadline(state);
  if (due === null || now < due) return state;

  if (state.phase === "answering") return resolveRound(state, now);
  if (state.phase === "reveal") return advanceAfterReveal(state, now);
  return state;
}

export function result(state: TriviaState): Result | null {
  if (state.phase !== "done") return null;
  return { kind: "scores", scores: { ...state.scores } };
}

export const triviaGame: GameModule<TriviaState, AnswerAction> = {
  id: "trivia",
  meta: { name: "Trivia", minPlayers: 2, maxPlayers: 8 },
  actionSchema: AnswerActionSchema,
  init,
  reduce,
  view,
  waitingOn,
  deadline,
  onDeadline,
  result,
};
