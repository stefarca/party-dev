import { z } from "zod";

import { nextInt } from "../../shared/prng";
import type { DailyGameModule, DailyScore } from "../../shared/game";

// Test-only daily fixture. Deliberately NOT registered in games/registry.ts:
// worker/daily.test.ts adds it to `dailyGames` for its own run and removes it
// afterwards, so the engine is tested against rules of its own rather than
// against 2048's.
//
// Each roll adds a die from the seeded PRNG to the total, and the run is over
// after `ROLLS` of them. `opening` is drawn from the seed at `init`, so a test
// can tell whether two runs were dealt the same day's seed. A `cheat` is
// always refused, which is how a test reaches a `reduce` that throws.

export const ROLLS = 3;

export interface DiceState {
  opening: number;
  rolls: number[];
  rng: number;
}

export type DiceAction = { t: "roll" } | { t: "cheat" };

export const DiceActionSchema: z.ZodType<DiceAction> = z.discriminatedUnion("t", [
  z.object({ t: z.literal("roll") }),
  z.object({ t: z.literal("cheat") }),
]);

function total(state: DiceState): number {
  return state.rolls.reduce((sum, roll) => sum + roll, 0);
}

export const diceGame: DailyGameModule<DiceState, DiceAction> = {
  id: "dice",
  meta: { name: "Dice", order: "desc", format: "number" },
  actionSchema: DiceActionSchema,
  init(seed) {
    const [opening, rng] = nextInt(seed, 1_000_000);
    return { opening, rolls: [], rng };
  },
  reduce(state, action) {
    if (action.t === "cheat") throw new Error("no cheating");
    if (state.rolls.length >= ROLLS) throw new Error("out of rolls");
    const [roll, rng] = nextInt(state.rng, 6);
    return { ...state, rolls: [...state.rolls, roll + 1], rng };
  },
  view(state) {
    return { opening: state.opening, rolls: state.rolls, total: total(state) };
  },
  finished(state) {
    return state.rolls.length >= ROLLS;
  },
  score(state): DailyScore {
    return {
      value: total(state),
      detail: { key: "chart.detail", values: { count: state.rolls.length } },
    };
  },
};
