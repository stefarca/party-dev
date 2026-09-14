import { describe, expect, it } from "vitest";

import {
  REVEAL_MS,
  ROUNDS,
  ROUND_TIMEOUT_MS,
  init,
  onDeadline,
  reduce,
  result,
  triviaGame,
  view,
  waitingOn,
} from "./game";
import type { TriviaState } from "./game";
import { QUESTIONS } from "./questions";

const PLAYERS = ["alice", "bob", "carol"];

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.values(obj as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(obj);
  }
  return obj;
}

function currentQuestion(state: TriviaState) {
  const id = state.questionIds[state.round];
  const q = QUESTIONS.find((q) => q.id === id);
  if (!q) throw new Error("test fixture: unknown question id");
  return q;
}

function answer(state: TriviaState, by: string, choice: number, now = 1000): TriviaState {
  return reduce(state, { t: "answer", round: state.round, choice }, by, now);
}

describe("trivia — init", () => {
  it("is deterministic for a fixed seed (question order)", () => {
    expect(init(PLAYERS, 7)).toEqual(init(PLAYERS, 7));
  });

  it("picks a different question order for a different seed (overwhelmingly likely)", () => {
    const a = init(PLAYERS, 1);
    const b = init(PLAYERS, 2);
    expect(a.questionIds).not.toEqual(b.questionIds);
  });

  it("rejects fewer than 2 players", () => {
    expect(() => init(["solo"], 1)).toThrow();
  });

  it("starts at round 0, phase answering, zeroed scores, untimed", () => {
    const state = init(PLAYERS, 1);
    expect(state.round).toBe(0);
    expect(state.phase).toBe("answering");
    expect(state.roundStartedAt).toBe(0);
    expect(state.questionIds).toHaveLength(ROUNDS);
    for (const p of PLAYERS) expect(state.scores[p]).toBe(0);
  });
});

describe("trivia — reduce: simultaneous answering", () => {
  it("resolves the round the instant everyone has answered, with no alarm involved", () => {
    let state = init(PLAYERS, 1);
    const q = currentQuestion(state);

    state = answer(state, "alice", q.answer, 1000);
    expect(state.phase).toBe("answering"); // not everyone has answered yet
    state = answer(state, "bob", q.answer, 1100);
    expect(state.phase).toBe("answering");
    state = answer(state, "carol", (q.answer + 1) % q.choices.length, 1200);

    // All three have now answered -> resolved immediately via reduce, no
    // onDeadline call anywhere in this test.
    expect(state.phase).toBe("reveal");
    expect(state.revealed).not.toBeNull();
    expect(state.scores.alice).toBe(1);
    expect(state.scores.bob).toBe(1);
    expect(state.scores.carol).toBe(0);
  });

  it("rejects a late answer carrying a stale round number", () => {
    let state = init(PLAYERS, 1);
    const q = currentQuestion(state);
    state = answer(state, "alice", q.answer, 1000);
    state = answer(state, "bob", q.answer, 1100);
    state = answer(state, "carol", q.answer, 1200); // resolves -> phase "reveal", round still 0

    expect(() => reduce(state, { t: "answer", round: 0, choice: 0 }, "alice", 1300)).toThrow();
  });

  it("rejects a second answer from the same player in the same round", () => {
    let state = init(PLAYERS, 1);
    const q = currentQuestion(state);
    state = answer(state, "alice", q.answer, 1000);
    expect(() => answer(state, "alice", q.answer, 1050)).toThrow();
  });

  it("rejects an out-of-range choice", () => {
    const state = init(PLAYERS, 1);
    const q = currentQuestion(state);
    expect(() => answer(state, "alice", q.choices.length, 1000)).toThrow();
  });

  it("rejects an answer once the round is no longer 'answering'", () => {
    let state = init(PLAYERS, 1);
    const q = currentQuestion(state);
    state = answer(state, "alice", q.answer, 1000);
    state = answer(state, "bob", q.answer, 1100);
    state = answer(state, "carol", q.answer, 1200); // now "reveal"
    expect(() =>
      reduce(state, { t: "answer", round: state.round, choice: 0 }, "alice", 1300),
    ).toThrow();
  });

  it("does not mutate its input state and returns a new object", () => {
    const state = deepFreeze(init(PLAYERS, 1));
    const before = structuredClone(state);
    const q = currentQuestion(state as TriviaState);
    const next = reduce(state, { t: "answer", round: 0, choice: q.answer }, "alice", 1000);
    expect(state).toEqual(before);
    expect(next).not.toBe(state);
  });
});

describe("trivia — onDeadline: timeout path", () => {
  function midRound(seed: number, roundStartedAt = 1000): TriviaState {
    return { ...init(PLAYERS, seed), roundStartedAt };
  }

  it("scores non-answerers 0 and resolves exactly once", () => {
    let state = midRound(1);
    const q = currentQuestion(state);
    state = answer(state, "alice", q.answer, state.roundStartedAt + 10);
    // bob and carol never answer.

    const due = state.roundStartedAt + ROUND_TIMEOUT_MS;
    const resolved = onDeadline(state, due + 1);

    expect(resolved.phase).toBe("reveal");
    expect(resolved.scores.alice).toBe(1);
    expect(resolved.scores.bob).toBe(0);
    expect(resolved.scores.carol).toBe(0);
    expect(resolved.revealed?.given.bob).toBeNull();
    expect(resolved.revealed?.given.carol).toBeNull();
  });

  it("is a no-op before the deadline has passed", () => {
    const state = midRound(1);
    expect(onDeadline(state, state.roundStartedAt + 1)).toEqual(state);
  });

  it("is a no-op right after init, before any round has a real start time", () => {
    const state = init(PLAYERS, 1);
    expect(onDeadline(state, 999_999_999)).toEqual(state);
  });

  it("applying onDeadline twice to the same state is a no-op the second time", () => {
    const state = midRound(1);
    const due = state.roundStartedAt + ROUND_TIMEOUT_MS;
    const once = onDeadline(state, due + 1);
    const twice = onDeadline(once, due + 1);
    expect(twice).toEqual(once);
  });

  it("advances reveal -> next round once REVEAL_MS elapses, and is idempotent there too", () => {
    let state = midRound(1);
    const q = currentQuestion(state);
    state = answer(state, "alice", q.answer, state.roundStartedAt + 10);
    state = answer(state, "bob", q.answer, state.roundStartedAt + 20);
    state = answer(state, "carol", q.answer, state.roundStartedAt + 30); // resolves -> reveal

    expect(state.phase).toBe("reveal");
    const revealDue = state.revealStartedAt + REVEAL_MS;

    const advanced = onDeadline(state, revealDue + 1);
    expect(advanced.phase).toBe("answering");
    expect(advanced.round).toBe(1);
    expect(advanced.answers).toEqual({});
    expect(advanced.revealed).toBeNull();

    // Idempotent: re-running onDeadline with the same `now` on the advanced
    // state (which is now well before its own new deadline) is a no-op.
    const again = onDeadline(advanced, revealDue + 1);
    expect(again).toEqual(advanced);
  });

  it("advancing past the final round's reveal ends the match", () => {
    let state = midRound(1);
    for (let r = 0; r < ROUNDS; r++) {
      const q = currentQuestion(state);
      state = answer(state, "alice", q.answer, state.roundStartedAt + 10);
      state = answer(state, "bob", q.answer, state.roundStartedAt + 20);
      state = answer(state, "carol", q.answer, state.roundStartedAt + 30); // -> reveal
      expect(state.phase).toBe("reveal");
      const revealDue = state.revealStartedAt + REVEAL_MS;
      state = onDeadline(state, revealDue + 1); // -> next round's "answering", or "done"
    }
    expect(state.phase).toBe("done");
    expect(result(state)).not.toBeNull();
  });
});

describe("trivia — view()", () => {
  it("never returns the state object itself", () => {
    const state = init(PLAYERS, 1);
    expect(view(state, "alice")).not.toBe(state);
  });

  it("leaks neither the correct answer nor other players' choices during answering (checked on the serialized JSON)", () => {
    let state = init(PLAYERS, 1);
    const q = currentQuestion(state);
    state = answer(state, "bob", (q.answer + 1) % q.choices.length, 1000); // bob answers, alice does not

    const projected = view(state, "alice");
    const json = JSON.stringify(projected);

    // The correct answer index must not appear anywhere in the serialized
    // view, under any key name. The scoreboard (which does legitimately
    // include every player's id) is fine; a per-player answer record is not.
    expect(json).not.toContain(`"answer":${q.answer}`);
    expect(json).not.toContain(`"correctAnswer":${q.answer}`);
    expect(json).not.toContain("given");
    expect(json).not.toContain("answers");

    const parsed = projected as { yourAnswer: number | null; answeredCount: number };
    expect(parsed.yourAnswer).toBeNull();
    expect(parsed.answeredCount).toBe(1);
  });

  it("reveals the correct answer and every player's pick once in the reveal phase", () => {
    let state = init(PLAYERS, 1);
    const q = currentQuestion(state);
    state = answer(state, "alice", q.answer, 1000);
    state = answer(state, "bob", q.answer, 1100);
    state = answer(state, "carol", (q.answer + 1) % q.choices.length, 1200);
    expect(state.phase).toBe("reveal");

    const projected = view(state, "alice") as {
      correctAnswer: number;
      given: Record<string, number | null>;
    };
    expect(projected.correctAnswer).toBe(q.answer);
    expect(projected.given.carol).toBe((q.answer + 1) % q.choices.length);
  });

  it("returns the final scoreboard once done", () => {
    let state = init(PLAYERS, 1);
    for (let r = 0; r < ROUNDS; r++) {
      const q = currentQuestion(state);
      state = answer(state, "alice", q.answer, 1000 + r * 100);
      state = answer(state, "bob", q.answer, 1010 + r * 100);
      state = answer(state, "carol", q.answer, 1020 + r * 100);
      const revealDue = state.revealStartedAt + REVEAL_MS;
      state = onDeadline(state, revealDue + 1);
    }
    expect(state.phase).toBe("done");
    const projected = view(state, "alice") as { phase: string; scores: Record<string, number> };
    expect(projected.phase).toBe("done");
    expect(projected.scores.alice).toBe(ROUNDS);
  });
});

describe("trivia — waitingOn", () => {
  it("shrinks as answers arrive and is [] once resolved or done", () => {
    let state = init(PLAYERS, 1);
    expect(waitingOn(state)).toEqual(["alice", "bob", "carol"]);

    const q = currentQuestion(state);
    state = answer(state, "alice", q.answer, 1000);
    expect(waitingOn(state)).toEqual(["bob", "carol"]);

    state = answer(state, "bob", q.answer, 1100);
    expect(waitingOn(state)).toEqual(["carol"]);

    state = answer(state, "carol", q.answer, 1200); // resolves -> reveal
    expect(state.phase).toBe("reveal");
    expect(waitingOn(state)).toEqual([]);
  });

  it("is [] once the match is done", () => {
    let state = init(PLAYERS, 1);
    for (let r = 0; r < ROUNDS; r++) {
      const q = currentQuestion(state);
      state = answer(state, "alice", q.answer, 1000 + r * 100);
      state = answer(state, "bob", q.answer, 1010 + r * 100);
      state = answer(state, "carol", q.answer, 1020 + r * 100);
      const revealDue = state.revealStartedAt + REVEAL_MS;
      state = onDeadline(state, revealDue + 1);
    }
    expect(state.phase).toBe("done");
    expect(waitingOn(state)).toEqual([]);
  });
});

describe("trivia — full playthrough", () => {
  it("plays ROUNDS rounds, ends with a non-null result and correctly-summed scores", () => {
    let state = init(PLAYERS, 42);
    let aliceCorrect = 0;
    const bobCorrect = 0;
    let carolCorrect = 0;

    for (let r = 0; r < ROUNDS; r++) {
      const q = currentQuestion(state);
      const wrong = (q.answer + 1) % q.choices.length;

      state = answer(state, "alice", q.answer, 1000 + r * 100);
      aliceCorrect++;
      state = answer(state, "bob", wrong, 1010 + r * 100);
      state = answer(state, "carol", q.answer, 1020 + r * 100);
      carolCorrect++;

      expect(state.phase).toBe("reveal");
      const revealDue = state.revealStartedAt + REVEAL_MS;
      state = onDeadline(state, revealDue + 1);
    }

    expect(state.phase).toBe("done");
    const finalResult = result(state);
    expect(finalResult).toEqual({
      kind: "scores",
      scores: { alice: aliceCorrect, bob: bobCorrect, carol: carolCorrect },
    });
  });
});

describe("trivia — module shape", () => {
  it("validates actions with actionSchema", () => {
    expect(triviaGame.actionSchema.safeParse({ t: "answer", round: 0, choice: 0 }).success).toBe(
      true,
    );
    expect(triviaGame.actionSchema.safeParse({ t: "answer", round: 0, choice: -1 }).success).toBe(
      false,
    );
    expect(triviaGame.actionSchema.safeParse({ t: "nonsense" }).success).toBe(false);
  });

  it("has 2-8 player bounds", () => {
    expect(triviaGame.meta.minPlayers).toBe(2);
    expect(triviaGame.meta.maxPlayers).toBe(8);
  });

  it("deadline is null once the match is done", () => {
    let state = init(PLAYERS, 1);
    for (let r = 0; r < ROUNDS; r++) {
      const q = currentQuestion(state);
      state = answer(state, "alice", q.answer, 1000 + r * 100);
      state = answer(state, "bob", q.answer, 1010 + r * 100);
      state = answer(state, "carol", q.answer, 1020 + r * 100);
      const revealDue = state.revealStartedAt + REVEAL_MS;
      state = onDeadline(state, revealDue + 1);
    }
    expect(triviaGame.deadline(state)).toBeNull();
  });
});
