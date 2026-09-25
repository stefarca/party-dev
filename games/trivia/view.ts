// What `view()` sends one player, phase by phase. Nothing in it that the
// phase has not revealed yet.

export interface AnsweringView {
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

export interface RevealView {
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

export interface DoneView {
  phase: "done";
  round: number;
  totalRounds: number;
  scores: Record<string, number>;
}

export type TriviaView = AnsweringView | RevealView | DoneView;
