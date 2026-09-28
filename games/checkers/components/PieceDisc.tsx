import type { CSSProperties } from "react";

import type { Piece, Side } from "../game";

// Colour is never the only signal: red pieces carry a solid inner ring and
// blue pieces a dashed one, kings add a crown, and every square's aria-label
// names the piece on it.
const SIDE_COLOR: Record<Side, string> = { red: "var(--seat-1)", blue: "var(--seat-2)" };
const SIDE_CONTRAST: Record<Side, string> = {
  red: "var(--seat-1-contrast)",
  blue: "var(--seat-2-contrast)",
};
const SIDE_RING_DASH: Record<Side, string | undefined> = { red: undefined, blue: "2.4 2.1" };

const GLOSS = "radial-gradient(circle at 34% 28%, var(--gloss-highlight), var(--gloss-fade) 56%)";
const CROWN = "M7 16 6.2 9.2 9.8 12 12 7.6 14.2 12 17.8 9.2 17 16z";

export function PieceDisc({
  piece,
  className = "",
  style,
}: {
  piece: Piece;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex aspect-square flex-none items-center justify-center rounded-full shadow-[var(--game-piece-shadow)] ${className}`}
      style={{
        backgroundColor: SIDE_COLOR[piece.side],
        backgroundImage: GLOSS,
        color: SIDE_CONTRAST[piece.side],
        ...style,
      }}
    >
      <svg viewBox="0 0 24 24" className="size-full">
        <circle
          cx="12"
          cy="12"
          r="8.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeDasharray={SIDE_RING_DASH[piece.side]}
          opacity={0.55}
        />
        {piece.king && <path d={CROWN} fill="currentColor" />}
      </svg>
    </span>
  );
}
