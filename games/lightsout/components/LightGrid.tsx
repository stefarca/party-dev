import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Focusable } from "../../common/keyboard";
import { SIZE, step } from "../game";
import { Light } from "./Light";

const ARROWS: Record<string, [dRow: number, dCol: number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

// The board, an ARIA grid with one tab stop: the selected light. The arrow
// keys move it and Space or Enter presses it. It keeps the selection itself,
// since nothing outside it needs one.
export function LightGrid({
  lights,
  playable,
  onPress,
}: {
  lights: readonly boolean[];
  playable: boolean;
  onPress: (cell: number) => void;
}) {
  const { t } = useTranslation("lightsout");
  const [selected, setSelected] = useState(0);
  // Whether the selection was last moved from the keyboard. Only then is it
  // ringed: a ring left on the light a mouse last pressed marks nothing.
  const [keyboard, setKeyboard] = useState(false);
  const cells = useRef<unknown[]>([]);

  return (
    <div className="@container w-full max-w-sm">
      <div
        role="grid"
        aria-label={t("board")}
        aria-readonly={playable ? undefined : true}
        className="flex w-full flex-col gap-[2.4cqw] rounded-[var(--radius-lg)] border-4 p-[3.2cqw] shadow-[var(--shadow-inset),var(--shadow-2)] select-none [-webkit-touch-callout:none]"
        style={{ background: "var(--board-well)", borderColor: "var(--board-rim)" }}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          const arrow = ARROWS[event.key];
          if (arrow) {
            const next = step(selected, arrow[0], arrow[1]);
            setSelected(next);
            (cells.current[next] as Focusable | undefined)?.focus();
          } else if (event.key === " " || event.key === "Enter") {
            if (!event.repeat) onPress(selected);
          } else {
            return;
          }
          event.preventDefault();
          setKeyboard(true);
        }}
      >
        {Array.from({ length: SIZE }, (_, row) => (
          <div key={row} role="row" className="flex gap-[2.4cqw]">
            {Array.from({ length: SIZE }, (_, col) => {
              const cell = row * SIZE + col;
              return (
                <Light
                  key={col}
                  on={lights[cell]}
                  label={t("cell.label", {
                    row: row + 1,
                    col: col + 1,
                    state: lights[cell] ? t("cell.on") : t("cell.off"),
                  })}
                  selected={cell === selected}
                  ringed={keyboard && cell === selected}
                  playable={playable}
                  cellRef={(element) => {
                    cells.current[cell] = element;
                  }}
                  onFocus={() => setSelected(cell)}
                  onPress={() => {
                    setKeyboard(false);
                    onPress(cell);
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
