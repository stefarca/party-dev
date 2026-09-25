import type { CSSProperties } from "react";

import { SIZE } from "./game";
import type { Placement } from "./game";

// What every layer of a board shares: where a run of squares sits, and how a
// piece set down on it lands.

export const LAND = "animate-[party-piece-land_var(--dur-slow)_var(--ease-spring)_both]";

// The box of `length` squares running from a placement's top-left end, as
// percentages of the board, drawn `inset` squares in from every edge.
export function box({ row, col, vertical }: Placement, length: number, inset = 0): CSSProperties {
  const width = vertical ? 1 : length;
  const height = vertical ? length : 1;
  const pct = (squares: number) => `${squares * (100 / SIZE)}%`;
  return {
    left: pct(col + inset),
    top: pct(row + inset),
    width: pct(width - 2 * inset),
    height: pct(height - 2 * inset),
  };
}
