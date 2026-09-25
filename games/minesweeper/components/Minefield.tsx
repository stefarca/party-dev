import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Focusable } from "../../common/keyboard";
import { COLS, ROWS, step } from "../game";
import type { MinesweeperView, Square as SquareState } from "../game";
import { useSquarePress } from "../useSquarePress";
import { Square } from "./Square";

const ARROWS: Record<string, [dRow: number, dCol: number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

// The minefield, an ARIA grid with one tab stop: the selected square. The
// arrow keys move it; Space or Enter opens the square and F flags it. It
// keeps the selection itself, since nothing outside it needs one.
export function Minefield({
  view: v,
  playable,
  onOpen,
  onFlag,
}: {
  view: MinesweeperView;
  playable: boolean;
  onOpen: (cell: number) => void;
  onFlag: (cell: number) => void;
}) {
  const { t } = useTranslation("minesweeper");
  const [selected, setSelected] = useState(0);
  // Whether the selection was last moved from the keyboard. Only then is it
  // ringed: a ring left on the square a mouse last clicked marks nothing.
  const [keyboard, setKeyboard] = useState(false);
  const cells = useRef<unknown[]>([]);
  const pressOn = useSquarePress({
    playable,
    onSelect: setSelected,
    onOpen,
    onFlag,
    onPointer: () => setKeyboard(false),
  });

  const contentOf = (square: SquareState): string => {
    if (square === "hidden") return t("cell.hidden");
    if (square === "flag") return t("cell.flag");
    if (square === "mine") return t("cell.mine");
    return square === 0 ? t("cell.clear") : t("cell.number", { count: square });
  };

  return (
    <div className="@container w-full">
      <div
        role="grid"
        aria-label={t("board")}
        aria-readonly={playable ? undefined : true}
        className="flex w-full flex-col gap-[0.6cqw] rounded-[var(--radius-lg)] border-4 p-[1.6cqw] shadow-[var(--shadow-inset),var(--shadow-2)] select-none [-webkit-touch-callout:none]"
        style={{ background: "var(--board-well)", borderColor: "var(--board-rim)" }}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          const arrow = ARROWS[event.key];
          if (arrow) {
            const next = step(selected, arrow[0], arrow[1]);
            setSelected(next);
            (cells.current[next] as Focusable | undefined)?.focus();
          } else if (event.key === " " || event.key === "Enter") {
            onOpen(selected);
          } else if (event.key === "f" || event.key === "F") {
            onFlag(selected);
          } else {
            return;
          }
          event.preventDefault();
          setKeyboard(true);
        }}
      >
        {Array.from({ length: ROWS }, (_, row) => (
          <div key={row} role="row" className="flex gap-[0.6cqw]">
            {Array.from({ length: COLS }, (_, col) => {
              const cell = row * COLS + col;
              return (
                <Square
                  key={col}
                  square={v.squares[cell]}
                  label={t("cell.label", {
                    row: row + 1,
                    col: col + 1,
                    content: contentOf(v.squares[cell]),
                  })}
                  selected={cell === selected}
                  ringed={keyboard && cell === selected}
                  playable={playable}
                  press={pressOn(cell)}
                  cellRef={(element) => {
                    cells.current[cell] = element;
                  }}
                  onFocus={() => setSelected(cell)}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
