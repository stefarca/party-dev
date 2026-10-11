import { addDays, dayStart } from "./daily";

// Streak freezes: a missed day that does not end a play streak. A streak earns one every
// `FREEZE_EVERY` days played in it, and holds at most `MAX_FREEZES`. A missed day uses one up, and
// so long as there are enough for every day missed, the streak carries on as if nothing happened:
// the frozen days do not add to it, but they do not end it either. A streak that does end takes
// whatever freezes were left with it, since there were not enough to save it.
//
// Like everything else about a streak, freezes are worked out from the days a player played and
// never stored. That keeps them from drifting out of step with the days themselves, and it means
// a player who played before freezes existed has the ones their streak earned. A day added to the
// list never shortens a run: it can only close a gap, or leave a freeze unspent.
//
// Its own module rather than part of the Worker, since the client tells the player how to earn one.

export const FREEZE_EVERY = 7;
export const MAX_FREEZES = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

// Whole days from `from` to `to`: 1 for consecutive days.
function daysBetween(from: string, to: string): number {
  return Math.round((dayStart(to) - dayStart(from)) / DAY_MS);
}

// The days strictly between `from` and `to`, oldest first.
function daysInGap(from: string, to: string): string[] {
  const gap: string[] = [];
  for (let day = addDays(from, 1); day < to; day = addDays(day, 1)) gap.push(day);
  return gap;
}

// A play streak as it stands after one day played.
export interface PlayStep {
  day: string;
  // Days played in the run so far, this one included.
  run: number;
  // Freezes held once this day is played.
  freezes: number;
  // The days in the run a freeze covered, oldest first.
  frozen: string[];
}

// How a list of days played, sorted and without repeats, makes a play streak: each one continues
// the run when it is the day after the one before, or when the run holds a freeze for every day
// missed between them.
export function playSteps(days: readonly string[]): PlayStep[] {
  const steps: PlayStep[] = [];
  for (const day of days) {
    const previous = steps.at(-1);
    let step: PlayStep;
    const missed = previous ? daysBetween(previous.day, day) - 1 : Infinity;
    if (previous && missed <= previous.freezes) {
      step = {
        day,
        run: previous.run + 1,
        freezes: previous.freezes - missed,
        frozen: [...previous.frozen, ...daysInGap(previous.day, day)],
      };
    } else {
      step = { day, run: 1, freezes: 0, frozen: [] };
    }
    if (step.run % FREEZE_EVERY === 0) step.freezes = Math.min(MAX_FREEZES, step.freezes + 1);
    steps.push(step);
  }
  return steps;
}

// Where the streak whose last day played is `last` stands on `today`. Today itself is never
// missed while it is still going, so it uses no freeze; every day between `last` and today does.
// Null when there were not enough freezes for them, and the streak is over.
export function streakOn(
  last: PlayStep,
  today: string,
): { run: number; freezes: number; frozen: string[] } | null {
  if (last.day >= today) return { run: last.run, freezes: last.freezes, frozen: last.frozen };
  const gap = daysInGap(last.day, today);
  if (gap.length > last.freezes) return null;
  return { run: last.run, freezes: last.freezes - gap.length, frozen: [...last.frozen, ...gap] };
}
