import { useState } from "react";

import { DICE, ROLLS, choices } from "./game";
import type { Category, YahtzeeView } from "./game";

const NONE: readonly boolean[] = new Array<boolean>(DICE).fill(false);

export interface Turn {
  // The dice held for the next roll.
  held: readonly boolean[];
  // A roll sent and not yet answered, for the tray to rattle the dice it throws.
  rolling: boolean;
  canHold: boolean;
  canRoll: boolean;
  // The boxes the dice may be scored in now: none before a roll, or while a
  // press is on its way.
  options: readonly Category[];
  // One die held, or let go.
  toggle(die: number): void;
  roll(): void;
  score(category: Category): void;
}

// The round in play on this page: which dice are held, and the press sent
// and not yet answered. Holds start from the ones the last roll was made with
// and change here, on this page, until they go with the next roll. A press
// sent locks the board until any new view arrives: the run as it now stands,
// or as the server has it after a send that failed.
export function useTurn(
  view: YahtzeeView | null,
  playable: boolean,
  send: (action: unknown) => void,
): Turn {
  const [holds, setHolds] = useState<{ held: boolean[]; against: unknown } | null>(null);
  const [pending, setPending] = useState<{ rolling: boolean; against: unknown } | null>(null);
  const waiting = pending !== null && pending.against === view;
  const held = holds !== null && holds.against === view ? holds.held : (view?.held ?? NONE);

  const live = view !== null && playable && !waiting;
  const rolled = view?.dice != null;
  const rollsLeft = view !== null && view.rolls < ROLLS;
  const canHold = live && rolled && rollsLeft;
  const canRoll = live && rollsLeft && !(rolled && held.every(Boolean));
  const options = live && view.dice !== null ? choices(view.card, view.dice) : [];

  return {
    held,
    rolling: waiting && pending.rolling,
    canHold,
    canRoll,
    options,
    toggle(die) {
      if (!canHold) return;
      setHolds({ held: held.map((on, i) => (i === die ? !on : on)), against: view });
    },
    roll() {
      if (!canRoll || !view) return;
      send({ t: "roll", round: view.round, roll: view.rolls, hold: rolled ? held : NONE });
      setPending({ rolling: true, against: view });
    },
    score(category) {
      if (!view || !options.includes(category)) return;
      send({ t: "score", round: view.round, category });
      setPending({ rolling: false, against: view });
    },
  };
}
