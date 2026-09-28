import type { Square as SquareState } from "../game";
import type { SquarePress } from "../useSquarePress";
import { SquareFace } from "./SquareFace";

// A hidden square stands up out of the well, lit along its top edge; an open
// one is sunk into it.
const RAISED = {
  background: "color-mix(in oklab, var(--board-mark) 55%, var(--board-rim))",
  boxShadow:
    "inset 0 0.4cqw 0 color-mix(in oklab, var(--board-peg) 30%, transparent), inset 0 -0.5cqw 0 color-mix(in oklab, var(--board-hole) 55%, transparent)",
} as const;
const SUNK = {
  background: "var(--board-hole)",
  boxShadow: "var(--shadow-inset)",
} as const;
const BLAST = {
  background: "var(--seat-1)",
  boxShadow: "0 0 2.4cqw var(--seat-1)",
} as const;

// One square of the minefield, as an ARIA grid cell. `ringed` draws the
// keyboard's selection ring on it.
export function Square({
  square,
  label,
  selected,
  ringed,
  playable,
  press,
  cellRef,
  onFocus,
}: {
  square: SquareState;
  label: string;
  selected: boolean;
  ringed: boolean;
  playable: boolean;
  press: SquarePress;
  cellRef: (element: unknown) => void;
  onFocus: () => void;
}) {
  const open = typeof square === "number";
  return (
    <div
      ref={cellRef}
      role="gridcell"
      tabIndex={selected ? 0 : -1}
      aria-selected={selected}
      aria-label={label}
      onFocus={onFocus}
      {...press}
      className={`flex aspect-square min-w-0 flex-1 items-center justify-center transition-[filter] duration-[var(--dur-fast)] touch-manipulation ${
        playable && !open ? "cursor-pointer hover:brightness-125" : ""
      }`}
      style={{
        ...(square === "mine" ? BLAST : open ? SUNK : RAISED),
        // Inline, so they win over the app-wide focus ring, which would
        // spill onto the neighbouring squares.
        borderRadius: "1cqw",
        outline: ringed ? "2px solid var(--board-peg)" : "none",
        outlineOffset: "-2px",
      }}
    >
      <SquareFace square={square} />
    </div>
  );
}
