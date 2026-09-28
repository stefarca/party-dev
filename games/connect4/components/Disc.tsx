import { useTranslation } from "react-i18next";

import { GLOSS, SEAT_COLOR, SEAT_CONTRAST, SEAT_GLYPH } from "../seats";
import type { Cell } from "../view";

export function Disc({
  seat,
  isLastMove,
  previewSeat,
}: {
  seat: Cell;
  isLastMove: boolean;
  previewSeat?: 0 | 1;
}) {
  const { t } = useTranslation("connect4");
  if (seat === null) {
    if (previewSeat !== undefined) {
      return (
        <span
          className="flex aspect-square w-full min-w-5 items-center justify-center rounded-full opacity-45 ring-2 ring-[var(--gloss-highlight)] ring-inset"
          style={{ backgroundColor: SEAT_COLOR[previewSeat] }}
          aria-hidden="true"
        />
      );
    }
    return (
      <span
        className="flex aspect-square w-full min-w-5 items-center justify-center rounded-full bg-[var(--board-hole)] shadow-[var(--shadow-inset)]"
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className={`flex aspect-square w-full min-w-5 items-center justify-center rounded-full text-xs font-bold shadow-[var(--game-piece-shadow)] sm:text-sm ${
        isLastMove
          ? "animate-[party-disc-drop_var(--dur-slow)_var(--ease-bounce)_both] ring-3 ring-[var(--accent)]"
          : ""
      }`}
      style={{
        backgroundColor: SEAT_COLOR[seat],
        backgroundImage: GLOSS,
        color: SEAT_CONTRAST[seat],
      }}
      role="img"
      aria-label={isLastMove ? t("lastMove", { disc: t(`disc.${seat}`) }) : t(`disc.${seat}`)}
    >
      {SEAT_GLYPH[seat]}
    </span>
  );
}
