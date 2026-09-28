import type { CSSProperties } from "react";

import type { Mark } from "../game";

// Colour is never the only signal: X and O are different shapes, and every
// square's aria-label names the mark in it.
export const MARK_COLOR: Record<Mark, string> = { X: "var(--seat-1)", O: "var(--seat-2)" };

// The newest mark draws itself in like a pen stroke; the second stroke of an
// X starts a beat after the first.
const DRAW_IN = "animate-[party-stroke-draw_var(--dur-slow)_var(--ease-out)_both]";
const DRAW_IN_SECOND = "animate-[party-stroke-draw_var(--dur-slow)_var(--ease-out)_140ms_both]";

export function MarkGlyph({
  mark,
  drawIn = false,
  className,
  style,
}: {
  mark: Mark;
  drawIn?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.4}
      strokeLinecap="round"
      className={className}
      style={{ color: MARK_COLOR[mark], ...style }}
      aria-hidden="true"
    >
      {mark === "X" ? (
        <>
          <path
            d="M6 6 18 18"
            pathLength={1}
            strokeDasharray={1}
            className={drawIn ? DRAW_IN : undefined}
          />
          <path
            d="M18 6 6 18"
            pathLength={1}
            strokeDasharray={1}
            className={drawIn ? DRAW_IN_SECOND : undefined}
          />
        </>
      ) : (
        // Rotated so the stroke starts at twelve o'clock rather than three.
        <circle
          cx="12"
          cy="12"
          r="6.5"
          transform="rotate(-90 12 12)"
          pathLength={1}
          strokeDasharray={1}
          className={drawIn ? DRAW_IN : undefined}
        />
      )}
    </svg>
  );
}
