import { useTranslation } from "react-i18next";

import { ROWS } from "../game";
import type { Connect4View } from "../view";
import { Disc } from "./Disc";

// One column of the board, which is also the button that drops a disc into
// it. While it is `active` (under the pointer or focus) it lifts, and shows
// a faint `previewSeat` disc on the square the drop would land on.
export function Column({
  view: v,
  col,
  disabled,
  active,
  previewSeat,
  onDrop,
  onActive,
  onInactive,
}: {
  view: Connect4View;
  col: number;
  disabled: boolean;
  active: boolean;
  previewSeat: 0 | 1 | null;
  onDrop: () => void;
  onActive: () => void;
  onInactive: () => void;
}) {
  const { t } = useTranslation("connect4");
  const full = v.board[ROWS - 1][col] !== null;
  const colDisabled = disabled || full;
  const canPreview = !colDisabled && previewSeat !== null;
  const landingRow = canPreview ? landingRowFor(v, col) : null;

  return (
    <button
      type="button"
      className={`flex cursor-pointer flex-col gap-1 rounded-[var(--radius-sm)] border-none p-1 transition-[background-color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed sm:gap-2 ${
        canPreview && active ? "-translate-y-0.5 bg-[var(--accent-soft)]" : "bg-transparent"
      }`}
      disabled={colDisabled}
      aria-label={t(full ? "column.full" : v.yourTurn ? "column.drop" : "column.notYourTurn", {
        column: col + 1,
      })}
      onClick={() => !colDisabled && onDrop()}
      onMouseEnter={() => canPreview && onActive()}
      onMouseLeave={onInactive}
      onFocus={() => canPreview && onActive()}
      onBlur={onInactive}
    >
      {/* Render top-to-bottom (row ROWS-1 down to 0) since row 0 is the bottom of the board. */}
      {Array.from({ length: ROWS }, (_, i) => ROWS - 1 - i).map((row) => (
        <Disc
          key={row}
          seat={v.board[row][col]}
          isLastMove={v.lastMove?.col === col && v.lastMove?.row === row}
          previewSeat={
            canPreview && active && landingRow === row ? (previewSeat ?? undefined) : undefined
          }
        />
      ))}
    </button>
  );
}

// The row a disc dropped into `col` would come to rest on, or null if the
// column is full.
function landingRowFor(v: Connect4View, col: number): number | null {
  for (let row = 0; row < ROWS; row++) {
    if (v.board[row][col] === null) return row;
  }
  return null;
}
