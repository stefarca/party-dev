import type { CSSProperties } from "react";

import { SIZE } from "./game";

// One cell's box inside the board: a quarter of it each way, moved into place
// by whole cells so that the move itself can be what animates.
export function cellStyle(cell: number): CSSProperties {
  const row = Math.floor(cell / SIZE);
  const col = cell % SIZE;
  return { transform: `translate(${col * 100}%, ${row * 100}%)` };
}

export const CELL_BOX = "absolute top-0 left-0 h-1/4 w-1/4 p-[1.5cqw]";
