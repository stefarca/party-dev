import { useRef } from "react";
import { useTranslation } from "react-i18next";

import type { Focusable } from "../../common/keyboard";
import { ARROWS, moveFrom } from "../arrows";
import { BOX, SIZE, boxOf, colOf, digitsIn, rowOf } from "../game";
import type { SudokuView } from "../game";
import { Square } from "./Square";

// A square's fill: the plain well, a tint for the row, column and box of the
// selected square, and a stronger one for every square holding the selected
// digit (and for the selected square itself, which also gets a ring). Mixed
// from the board's own tokens, which are the same in both themes.
const FILL = {
  plain: "var(--board-hole)",
  peer: "color-mix(in oklab, var(--board-mark) 25%, var(--board-hole))",
  same: "color-mix(in oklab, var(--board-mark) 55%, var(--board-hole))",
} as const;

// The wider gap before the first row of each box but the first. Written out
// in full: Tailwind only emits class names it can read in the source.
const BOX_GAP_ROW = "mt-[1.5cqw]";

// The 9×9 grid, an ARIA grid with one tab stop: the selected square. The
// arrow keys pressed inside it move the selection and focus with it.
export function Grid({
  view: v,
  values,
  clash,
  selected,
  playable,
  onSelect,
}: {
  view: SudokuView;
  values: number[];
  clash: boolean[];
  selected: number | null;
  playable: boolean;
  onSelect: (cell: number) => void;
}) {
  const { t } = useTranslation("sudoku");
  const cells = useRef<unknown[]>([]);
  const selectedDigit = selected !== null && values[selected] !== 0 ? values[selected] : null;

  const cellLabel = (cell: number): string => {
    const digit = values[cell];
    let content: string;
    if (digit !== 0) {
      content = v.givens[cell] ? t("cell.given", { digit }) : t("cell.entered", { digit });
      if (clash[cell]) content = t("cell.clash", { content, digit });
    } else if (v.notes[cell] !== 0) {
      content = t("cell.notes", { notes: digitsIn(v.notes[cell]).join(" ") });
    } else {
      content = t("cell.empty");
    }
    return t("cell.label", { row: rowOf(cell) + 1, col: colOf(cell) + 1, content });
  };

  const fillOf = (cell: number): string => {
    if (selected === null) return FILL.plain;
    if (cell === selected || (selectedDigit !== null && values[cell] === selectedDigit)) {
      return FILL.same;
    }
    const peer =
      rowOf(cell) === rowOf(selected) ||
      colOf(cell) === colOf(selected) ||
      boxOf(cell) === boxOf(selected);
    return peer ? FILL.peer : FILL.plain;
  };

  const focusable = selected ?? 0;
  return (
    <div className="@container w-full">
      <div
        role="grid"
        aria-label={t("board")}
        aria-readonly={playable ? undefined : true}
        className="flex w-full flex-col gap-[0.5cqw] rounded-[var(--radius-lg)] border-4 p-[1.6cqw] shadow-[var(--shadow-inset),var(--shadow-2)] select-none"
        style={{ background: "var(--board-well)", borderColor: "var(--board-rim)" }}
        onKeyDown={(event) => {
          const arrow = ARROWS[event.key];
          if (!arrow) return;
          event.preventDefault();
          const next = moveFrom(selected, arrow);
          onSelect(next);
          (cells.current[next] as Focusable | undefined)?.focus();
        }}
      >
        {Array.from({ length: SIZE }, (_, row) => (
          <div
            key={row}
            role="row"
            className={`flex gap-[0.5cqw] ${row > 0 && row % BOX === 0 ? BOX_GAP_ROW : ""}`}
          >
            {Array.from({ length: SIZE }, (_, col) => {
              const cell = row * SIZE + col;
              return (
                <Square
                  key={col}
                  label={cellLabel(cell)}
                  fill={fillOf(cell)}
                  selected={cell === selected}
                  tabbable={cell === focusable}
                  boxStart={col > 0 && col % BOX === 0}
                  given={v.givens[cell] !== 0}
                  digit={values[cell]}
                  clash={clash[cell]}
                  notes={v.notes[cell]}
                  selectedDigit={selectedDigit}
                  cellRef={(element) => {
                    cells.current[cell] = element;
                  }}
                  onSelect={() => onSelect(cell)}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
