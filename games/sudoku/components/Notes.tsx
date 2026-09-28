import { DIGITS } from "../digits";

// A square's pencil marks, each digit in its own place in a 3×3 grid, the
// selected digit picked out.

export function Notes({ mask, highlight }: { mask: number; highlight: number | null }) {
  return (
    <span aria-hidden="true" className="grid size-full grid-cols-3 grid-rows-3 p-[0.4cqw]">
      {DIGITS.map((digit) => {
        const shown = (mask & (1 << (digit - 1))) !== 0;
        const lit = shown && digit === highlight;
        return (
          <span
            key={digit}
            className={`flex items-center justify-center font-display leading-none tabular-nums ${
              lit ? "font-bold" : "font-medium"
            }`}
            style={{
              fontSize: "2.4cqw",
              color: lit ? "var(--board-peg)" : "var(--board-hull)",
            }}
          >
            {shown ? digit : ""}
          </span>
        );
      })}
    </span>
  );
}
