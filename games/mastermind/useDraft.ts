import { useState } from "react";

import { PEGS } from "./game";

export interface Draft {
  // What the current row shows: the guess being built, or the one sent and
  // not yet answered.
  pegs: (number | null)[];
  canEdit: boolean;
  full: boolean;
  used: Set<number>;
  // A colour into the first empty hole.
  pick(color: number): void;
  // The last colour out again.
  erase(): void;
  // One hole emptied.
  clear(slot: number): void;
  // The row sent as a guess, once every hole is filled.
  check(): void;
}

// The row being built, a colour or null per hole, and the guess it became
// once sent. That guess stands in the row until any new view arrives: the
// marked guess, or the run as the server has it after a send that failed.
export function useDraft(view: unknown, playable: boolean, send: (action: unknown) => void): Draft {
  const [draft, setDraft] = useState<(number | null)[]>(() => new Array(PEGS).fill(null));
  const [pending, setPending] = useState<{ pegs: number[]; against: unknown } | null>(null);
  const waiting = pending !== null && pending.against === view;
  const canEdit = playable && !waiting;
  const full = draft.every((color) => color !== null);
  const used = new Set(draft.filter((color): color is number => color !== null));

  return {
    pegs: waiting ? pending.pegs : draft,
    canEdit,
    full,
    used,
    pick(color) {
      if (!canEdit || used.has(color)) return;
      const slot = draft.indexOf(null);
      if (slot === -1) return;
      setDraft(draft.map((peg, i) => (i === slot ? color : peg)));
    },
    erase() {
      if (!canEdit) return;
      let last = PEGS - 1;
      while (last >= 0 && draft[last] === null) last--;
      if (last >= 0) setDraft(draft.map((peg, i) => (i === last ? null : peg)));
    },
    clear(slot) {
      if (!canEdit) return;
      setDraft(draft.map((peg, i) => (i === slot ? null : peg)));
    },
    check() {
      if (!canEdit || !full) return;
      const pegs = draft as number[];
      send({ t: "guess", pegs });
      setPending({ pegs, against: view });
      setDraft(new Array(PEGS).fill(null));
    },
  };
}
