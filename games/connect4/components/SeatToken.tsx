import { GLOSS, SEAT_COLOR, SEAT_CONTRAST, SEAT_GLYPH } from "../seats";

// A seat's disc in miniature, for its badge above the board.
export function SeatToken({ seat }: { seat: 0 | 1 }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-6 flex-none items-center justify-center rounded-full text-[0.6rem] font-bold shadow-[var(--shadow-1)]"
      style={{
        backgroundColor: SEAT_COLOR[seat],
        backgroundImage: GLOSS,
        color: SEAT_CONTRAST[seat],
      }}
    >
      {SEAT_GLYPH[seat]}
    </span>
  );
}
