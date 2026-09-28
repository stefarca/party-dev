import { LightGlyph } from "./LightGlyph";

// A light that is on glows up out of the well, lit along its top edge; one
// that is off is a dark hole sunk into it.
const ON = {
  background: "var(--tile-128)",
  boxShadow:
    "0 0 3cqw color-mix(in oklab, var(--tile-128) 55%, transparent), inset 0 0.6cqw 0 var(--gloss-highlight), inset 0 -0.8cqw 0 color-mix(in oklab, var(--tile-256) 70%, transparent)",
} as const;
const OFF = {
  background: "var(--board-hole)",
  boxShadow: "var(--shadow-inset)",
} as const;

// One light of the board, as an ARIA grid cell. `ringed` draws the
// keyboard's selection ring on it.
export function Light({
  on,
  label,
  selected,
  ringed,
  playable,
  cellRef,
  onFocus,
  onPress,
}: {
  on: boolean;
  label: string;
  selected: boolean;
  ringed: boolean;
  playable: boolean;
  cellRef: (element: unknown) => void;
  onFocus: () => void;
  onPress: () => void;
}) {
  return (
    <div
      ref={cellRef}
      role="gridcell"
      tabIndex={selected ? 0 : -1}
      aria-selected={selected}
      aria-label={label}
      onFocus={onFocus}
      onClick={onPress}
      className={`flex aspect-square min-w-0 flex-1 items-center justify-center transition-[background-color,box-shadow,transform] duration-[var(--dur-base)] ease-[var(--ease-out)] touch-manipulation ${
        playable ? "cursor-pointer hover:brightness-110 active:scale-95" : ""
      }`}
      style={{
        ...(on ? ON : OFF),
        // Inline, so they win over the app-wide focus ring.
        borderRadius: "3cqw",
        outline: ringed ? "3px solid var(--board-peg)" : "none",
        outlineOffset: "2px",
      }}
    >
      <LightGlyph on={on} />
    </div>
  );
}
