import { useState } from "react";
import { useTranslation } from "react-i18next";

import { COLS, ROWS } from "../game";
import type { Connect4View } from "../view";
import { Column } from "./Column";

// The board: a frame of columns, each one a drop button. It keeps which
// column is under the pointer or focus, which only it needs.
export function Board({
  view: v,
  disabled,
  yourSeat,
  onDrop,
}: {
  view: Connect4View;
  disabled: boolean;
  yourSeat: 0 | 1 | null;
  onDrop: (col: number) => void;
}) {
  const { t } = useTranslation("connect4");
  const [activeCol, setActiveCol] = useState<number | null>(null);

  return (
    <div
      className="mx-auto grid w-full max-w-lg gap-1 rounded-[var(--radius-lg)] border-4 p-1.5 shadow-[var(--shadow-inset),var(--shadow-2)] sm:gap-2 sm:p-3"
      aria-label={t("board", { columns: COLS, rows: ROWS })}
      style={{
        gridTemplateColumns: `repeat(${COLS}, 1fr)`,
        background: "var(--board-well)",
        borderColor: "var(--board-rim)",
      }}
    >
      {Array.from({ length: COLS }, (_, col) => (
        <Column
          key={col}
          view={v}
          col={col}
          disabled={disabled}
          active={activeCol === col}
          previewSeat={yourSeat}
          onDrop={() => onDrop(col)}
          onActive={() => setActiveCol(col)}
          onInactive={() => setActiveCol((c) => (c === col ? null : c))}
        />
      ))}
    </div>
  );
}
