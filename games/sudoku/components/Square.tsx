import { SquareFace } from "./SquareFace";

// The wider gap that sets the 3×3 boxes apart, before the first column of
// each box but the first. Written out in full: Tailwind only emits class
// names it can read in the source.
const BOX_GAP_COL = "ml-[1.5cqw]";

// One square of the grid, as an ARIA grid cell. Only the `tabbable` one is
// in the tab order; the arrow keys move between them.
export function Square({
  label,
  fill,
  selected,
  tabbable,
  boxStart,
  given,
  digit,
  clash,
  notes,
  selectedDigit,
  cellRef,
  onSelect,
}: {
  label: string;
  fill: string;
  selected: boolean;
  tabbable: boolean;
  // The first column of a 3×3 box, past the first.
  boxStart: boolean;
  given: boolean;
  digit: number;
  clash: boolean;
  notes: number;
  selectedDigit: number | null;
  cellRef: (element: unknown) => void;
  onSelect: () => void;
}) {
  return (
    <div
      ref={cellRef}
      role="gridcell"
      tabIndex={tabbable ? 0 : -1}
      aria-selected={selected}
      aria-readonly={given || undefined}
      aria-label={label}
      onFocus={onSelect}
      onClick={onSelect}
      className={`flex aspect-square min-w-0 flex-1 cursor-pointer items-center justify-center shadow-[var(--shadow-inset)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] touch-manipulation ${
        boxStart ? BOX_GAP_COL : ""
      }`}
      style={{
        background: fill,
        // Inline, so they win over the app-wide focus ring, which would
        // spill onto the neighbouring squares. In the grid, the focused
        // square is always the selected one, and this ring marks both.
        borderRadius: "0.9cqw",
        outline: selected ? "2px solid var(--board-peg)" : "none",
        outlineOffset: "-2px",
      }}
    >
      <SquareFace
        digit={digit}
        given={given}
        clash={clash}
        notes={notes}
        selectedDigit={selectedDigit}
      />
    </div>
  );
}
