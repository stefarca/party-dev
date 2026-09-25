import type { Cell, Mark } from "../game";
import { MarkGlyph } from "./MarkGlyph";

// One square of the board, and the button that plays it. `winIndex` is its
// place along the winning line (-1 when it is not on it), which staggers
// the line's celebration. An empty square the player can take shows a faint
// preview of `yourMark` under the pointer or keyboard focus.
export function Square({
  cell,
  label,
  playable,
  drawIn,
  winIndex,
  yourMark,
  onPlace,
}: {
  cell: Cell;
  label: string;
  playable: boolean;
  drawIn: boolean;
  winIndex: number;
  yourMark: Mark | null;
  onPlace: () => void;
}) {
  const inWinLine = winIndex >= 0;
  return (
    <button
      type="button"
      disabled={!playable}
      onClick={() => playable && onPlace()}
      aria-label={label}
      className={`group flex aspect-square items-center justify-center rounded-[var(--radius-md)] border-none p-0 transition-[background-color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-default ${
        inWinLine
          ? "bg-[var(--accent-soft)] ring-3 ring-[var(--accent)] ring-inset"
          : "bg-[var(--board-hole)] shadow-[var(--shadow-inset)]"
      } ${playable ? "cursor-pointer hover:-translate-y-0.5 hover:bg-[var(--accent-soft)]" : ""}`}
    >
      {cell !== null ? (
        <MarkGlyph
          mark={cell}
          drawIn={drawIn}
          className="size-3/5"
          style={
            inWinLine
              ? {
                  animation: "party-celebrate 1.6s var(--ease-spring) infinite",
                  animationDelay: `${winIndex * 120}ms`,
                }
              : undefined
          }
        />
      ) : (
        playable &&
        yourMark && (
          <MarkGlyph
            mark={yourMark}
            className="size-3/5 opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover:opacity-35 group-focus-visible:opacity-35"
          />
        )
      )}
    </button>
  );
}
