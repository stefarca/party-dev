import { useTranslation } from "react-i18next";

import { CELLS, SIZE } from "../game";
import type { Cell } from "../game";
import type { TicTacToeView } from "../view";
import { Square } from "./Square";

// The 3×3 board. Each square's accessible name says where it is, what is on
// it, and whether it was the last move or is on the winning line.
export function Board({
  view: v,
  onPlace,
}: {
  view: TicTacToeView;
  onPlace: (cell: number) => void;
}) {
  const { t } = useTranslation("tictactoe");
  const yourMark = v.you === "spectator" ? null : v.you;

  const cellLabel = (index: number, cell: Cell, playable: boolean): string => {
    const square = t("square.position", {
      row: Math.floor(index / SIZE) + 1,
      column: (index % SIZE) + 1,
    });
    if (cell === null) {
      return playable && yourMark
        ? t("square.emptyPlayable", { square, mark: yourMark })
        : t("square.empty", { square });
    }
    const notes = [
      index === v.lastMove ? t("square.lastMove") : null,
      v.winLine?.includes(index) ? t("square.winningLine") : null,
    ].filter(Boolean);
    return [t("square.taken", { square, mark: cell }), ...notes].join(", ");
  };

  return (
    <div
      role="group"
      aria-label={t("board", { size: SIZE })}
      className="mx-auto grid w-full max-w-xs gap-2 rounded-[var(--radius-lg)] border-4 p-2 shadow-[var(--shadow-inset),var(--shadow-2)] sm:max-w-sm sm:gap-3 sm:p-3"
      style={{
        gridTemplateColumns: `repeat(${SIZE}, 1fr)`,
        background: "var(--board-well)",
        borderColor: "var(--board-rim)",
      }}
    >
      {Array.from({ length: CELLS }, (_, i) => {
        const cell = v.board[i];
        const playable = v.yourTurn && cell === null;
        return (
          <Square
            key={i}
            cell={cell}
            label={cellLabel(i, cell, playable)}
            playable={playable}
            drawIn={i === v.lastMove}
            winIndex={v.winLine?.indexOf(i) ?? -1}
            yourMark={yourMark}
            onPlace={() => onPlace(i)}
          />
        );
      })}
    </div>
  );
}
