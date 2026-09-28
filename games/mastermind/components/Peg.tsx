import { Glyph } from "./Glyph";

// Written out in full: Tailwind only emits class names it can read in the
// source.
const FILL = [
  "var(--code-1)",
  "var(--code-2)",
  "var(--code-3)",
  "var(--code-4)",
  "var(--code-5)",
  "var(--code-6)",
  "var(--code-7)",
] as const;
const INK = [
  "var(--code-1-ink)",
  "var(--code-2-ink)",
  "var(--code-3-ink)",
  "var(--code-4-ink)",
  "var(--code-5-ink)",
  "var(--code-6-ink)",
  "var(--code-7-ink)",
] as const;

// One code peg, filling whatever box it is given.
export function Peg({ color, pop = false }: { color: number; pop?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`size-full rounded-full ${
        pop ? "animate-[party-tile-spawn_var(--dur-base)_var(--ease-spring)_both]" : ""
      }`}
      style={{ background: FILL[color], boxShadow: "var(--game-piece-shadow)" }}
    >
      <g fill={INK[color]}>
        <Glyph color={color} />
      </g>
    </svg>
  );
}
