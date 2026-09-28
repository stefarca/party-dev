import { useState } from "react";

import type { Piece } from "./game";
import type { CheckersView } from "./view";

export interface MoveInProgress {
  // Every square a piece this player may move stands on.
  movable: Set<number>;
  // The squares picked so far this turn: the piece, then each landing square
  // of a jump in progress.
  selection: number[];
  // Where the picked piece may go next.
  targets: Set<number>;
  // The piece being moved, if one is picked.
  moving: Piece | null;
  // Pieces the jump in progress has already passed over.
  jumping: Set<number>;
  // A square pressed: picks a piece up, puts it down, or moves it on.
  choose(square: number): void;
}

const NONE: MoveInProgress = {
  movable: new Set(),
  selection: [],
  targets: new Set(),
  moving: null,
  jumping: new Set(),
  choose: () => {},
};

// A move built square by square: pick a piece, then each square it lands on.
// Once only one legal move is left that starts that way, it is sent whole.
export function useMove(v: CheckersView | null, send: (action: unknown) => void): MoveInProgress {
  // Tagged with the turn it was picked on, so the next snapshot clears it
  // without an effect.
  const [picked, setPicked] = useState<{ turnNo: number; path: number[] }>({
    turnNo: -1,
    path: [],
  });
  if (!v) return NONE;

  const movable = new Set(v.moves.map((path) => path[0]));
  const chosen = picked.turnNo === v.turnNo ? picked.path : [];
  // When only one piece can move (a forced jump, say), it starts picked up.
  const selection = chosen.length > 0 ? chosen : movable.size === 1 ? [...movable] : [];
  const targets = new Set(
    selection.length > 0
      ? v.moves.filter((path) => startsWith(path, selection)).map((path) => path[selection.length])
      : [],
  );
  const moving = selection.length > 0 ? v.board[selection[0]] : null;
  // A jump lands two squares away diagonally, so the jumped square is the
  // midpoint.
  const jumping = new Set<number>();
  for (let i = 1; i < selection.length; i++) {
    jumping.add((selection[i - 1] + selection[i]) / 2);
  }

  const choose = (square: number) => {
    if (targets.has(square)) {
      const path = [...selection, square];
      const remaining = v.moves.filter((m) => startsWith(m, path));
      if (remaining.length === 1) {
        // The rest of the move is forced, so finish it rather than asking
        // for every hop.
        send({ t: "move", path: remaining[0] });
        setPicked({ turnNo: v.turnNo, path: [] });
      } else {
        setPicked({ turnNo: v.turnNo, path });
      }
    } else if (square === selection[0]) {
      setPicked({ turnNo: v.turnNo, path: [] });
    } else if (movable.has(square)) {
      setPicked({ turnNo: v.turnNo, path: [square] });
    }
  };

  return { movable, selection, targets, moving, jumping, choose };
}

function startsWith(path: number[], prefix: number[]): boolean {
  return prefix.every((square, i) => path[i] === square);
}
