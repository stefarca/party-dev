import { useEffect, useState } from "react";

// A one-shot confetti burst for a win. Pure decoration: fixed, `aria-hidden`
// and `pointer-events: none`, so it can never cover a control or reach a
// screen reader — the result is always also stated in text next to it.
//
// The pieces are plain spans animated by one keyframe in the stylesheet,
// each reading its own colour/drift/spin/delay from inline custom
// properties. After the longest piece lands the whole burst unmounts, so a
// finished match does not leave 60 animated nodes in the tree.

const COLORS = [
  "var(--accent)",
  "var(--party-pink)",
  "var(--party-warm)",
  "var(--party-mint)",
  "var(--seat-1)",
  "var(--seat-2)",
];

const PIECES = 64;
const MAX_DELAY_MS = 900;
const FALL_MS = 2600;

interface Piece {
  color: string;
  x: number;
  drift: number;
  spin: number;
  delay: number;
  duration: number;
  width: number;
  height: number;
  round: boolean;
}

function makePieces(): Piece[] {
  return Array.from({ length: PIECES }, (_, i) => ({
    color: COLORS[i % COLORS.length],
    x: Math.random() * 100,
    drift: (Math.random() - 0.5) * 40,
    spin: 360 + Math.random() * 720,
    delay: Math.random() * MAX_DELAY_MS,
    duration: FALL_MS * (0.7 + Math.random() * 0.6),
    width: 0.4 + Math.random() * 0.5,
    height: 0.6 + Math.random() * 0.7,
    round: i % 3 === 0,
  }));
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function Confetti({ fire }: { fire: boolean }) {
  // Keyed by how many times `fire` has gone true, so re-firing restarts the
  // animation rather than reusing a burst that has already played out.
  const [burst, setBurst] = useState<{ id: number; pieces: Piece[] } | null>(null);

  useEffect(() => {
    if (!fire || prefersReducedMotion()) return;
    setBurst({ id: Date.now(), pieces: makePieces() });
    const timer = setTimeout(() => setBurst(null), FALL_MS * 1.3 + MAX_DELAY_MS);
    return () => clearTimeout(timer);
  }, [fire]);

  if (!burst) return null;

  return (
    <div
      key={burst.id}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
    >
      {burst.pieces.map((piece, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={
            {
              "--confetti-color": piece.color,
              "--confetti-x": `${piece.x}%`,
              "--confetti-drift": `${piece.drift}vw`,
              "--confetti-spin": `${piece.spin}deg`,
              "--confetti-delay": `${piece.delay}ms`,
              "--confetti-duration": `${piece.duration}ms`,
              width: `${piece.width}rem`,
              height: `${piece.height}rem`,
              borderRadius: piece.round ? "50%" : undefined,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
