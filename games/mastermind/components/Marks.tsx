import { PEGS } from "../game";
import type { Guess } from "../game";

// A row's marks, one small peg each: filled for a peg in place, a ring for
// one misplaced, an empty hole for the rest.
export function Marks({ guess }: { guess: Guess | null }) {
  const exact = guess?.exact ?? 0;
  const near = guess?.near ?? 0;
  return (
    <span aria-hidden="true" className="grid w-[15cqw] flex-none grid-cols-3 gap-[1cqw]">
      {Array.from({ length: PEGS }, (_, i) => (
        <span
          key={i}
          className="aspect-square rounded-full"
          style={
            i < exact
              ? { background: "var(--board-peg)" }
              : i < exact + near
                ? { border: "0.9cqw solid var(--board-peg)", background: "var(--board-hole)" }
                : { background: "var(--board-hole)", boxShadow: "var(--shadow-inset)" }
          }
        />
      ))}
    </span>
  );
}
