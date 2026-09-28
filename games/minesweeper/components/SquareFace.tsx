import type { Square } from "../game";
import { FlagGlyph } from "./FlagGlyph";
import { MineGlyph } from "./MineGlyph";

// Each number in a colour of its own, the way every minefield draws them, all
// from the board's own tokens so they read the same in both themes. The digit,
// not the colour, is what says how many.
const NUMBER_COLOUR: Record<number, string> = {
  1: "var(--tile-8)",
  2: "var(--tile-32)",
  3: "var(--tile-1024)",
  4: "var(--tile-4)",
  5: "var(--tile-256)",
  6: "var(--tile-16)",
  7: "var(--tile-2048)",
  8: "var(--board-hull)",
};

// What a square shows inside its tile: its number, a planted flag, or the
// mine that went off. A hidden square and an empty one show nothing.
export function SquareFace({ square }: { square: Square }) {
  return typeof square === "number" ? (
    square > 0 && (
      <span
        aria-hidden="true"
        className="animate-[party-tile-spawn_var(--dur-fast)_var(--ease-out)_both] font-display leading-none font-bold tabular-nums"
        style={{ fontSize: "5.4cqw", color: NUMBER_COLOUR[square] }}
      >
        {square}
      </span>
    )
  ) : square === "flag" ? (
    <span
      key="flag"
      className="flex size-full animate-[party-piece-land_var(--dur-base)_var(--ease-spring)_both] items-center justify-center"
    >
      <FlagGlyph className="size-[72%]" />
    </span>
  ) : square === "mine" ? (
    <span className="flex size-full animate-[party-tile-merge_var(--dur-slow)_var(--ease-bounce)_2] items-center justify-center">
      <MineGlyph />
    </span>
  ) : null;
}
