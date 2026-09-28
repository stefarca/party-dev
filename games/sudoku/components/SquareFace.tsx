import { Notes } from "./Notes";

// What a square shows: its digit, drawn bold if it was given and underlined
// if it clashes, or else its notes. The square around it, and its accessible
// name, belong to the grid.
export function SquareFace({
  digit,
  given,
  clash,
  notes,
  selectedDigit,
}: {
  digit: number;
  given: boolean;
  clash: boolean;
  notes: number;
  selectedDigit: number | null;
}) {
  return digit !== 0 ? (
    <span
      // Keyed by digit, so a new entry mounts afresh and pops in.
      key={digit}
      aria-hidden="true"
      className={`font-display leading-none tabular-nums ${
        given
          ? "font-bold"
          : "animate-[party-tile-spawn_var(--dur-base)_var(--ease-spring)_both] font-medium"
      } ${clash ? "underline decoration-wavy decoration-2 underline-offset-[0.8cqw]" : ""}`}
      style={{
        fontSize: "6.2cqw",
        color: clash ? "var(--tile-1024)" : given ? "var(--board-peg)" : "var(--tile-8)",
      }}
    >
      {digit}
    </span>
  ) : notes !== 0 ? (
    <Notes mask={notes} highlight={selectedDigit} />
  ) : null;
}
