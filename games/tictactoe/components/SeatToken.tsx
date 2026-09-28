import type { Mark } from "../game";
import { MarkGlyph } from "./MarkGlyph";

// A seat's mark on a blank square, for its badge above the board.
export function SeatToken({ mark }: { mark: Mark }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-7 flex-none items-center justify-center rounded-full bg-[var(--board-hole)] shadow-[var(--shadow-1)]"
    >
      <MarkGlyph mark={mark} className="size-5" />
    </span>
  );
}
