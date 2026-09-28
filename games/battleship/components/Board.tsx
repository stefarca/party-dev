import type { KeyboardEvent, ReactNode } from "react";

import { box } from "../board";
import { CELLS, SIZE, cellName } from "../game";
import type { ShotView } from "../game";
import { Hull } from "./Hull";
import type { HullSpec } from "./Hull";
import { Peg } from "./Peg";

const GRID_LINES =
  "linear-gradient(to right, var(--board-rim) 1px, transparent 1px), linear-gradient(to bottom, var(--board-rim) 1px, transparent 1px)";

const ROW_LETTERS = Array.from({ length: SIZE }, (_, row) => cellName(row * SIZE).charAt(0));

export interface CellSpec {
  label: string;
  active: boolean; // pressing it does something
  peg: ShotView | null;
}

export function Board({
  label,
  caption,
  hulls,
  cell,
  lastShot,
  crosshair = false,
  lockedAs = "disabled",
  footer,
  onCell,
  onHover,
  onKeyDown,
}: {
  label: string;
  caption: string;
  hulls: HullSpec[];
  cell: (square: number) => CellSpec;
  lastShot: number | null;
  crosshair?: boolean;
  // How a square that does nothing is shut. `disabled` takes it out of the
  // tab order; `aria` keeps it focusable and under the pointer, so the ship
  // being placed can still be previewed over it.
  lockedAs?: "disabled" | "aria";
  footer?: ReactNode;
  onCell?: (square: number) => void;
  onHover?: (square: number | null) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
}) {
  return (
    <section className="mx-auto flex w-full max-w-md min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-1">
        <h3 className="m-0 font-display text-sm font-bold text-[var(--text-primary)]">{label}</h3>
        <span className="truncate text-xs text-[var(--text-muted)]">{caption}</span>
      </div>
      <div
        role="group"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="rounded-[var(--radius-lg)] border-4 p-1.5 shadow-[var(--shadow-inset),var(--shadow-2)] sm:p-2"
        style={{ background: "var(--board-well)", borderColor: "var(--board-rim)" }}
      >
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-1">
          <span aria-hidden="true" />
          <div
            aria-hidden="true"
            className="grid text-center font-display text-[10px] leading-none font-bold text-[var(--board-hull)] tabular-nums sm:text-xs"
            style={{ gridTemplateColumns: `repeat(${SIZE}, 1fr)` }}
          >
            {Array.from({ length: SIZE }, (_, col) => (
              <span key={col}>{col + 1}</span>
            ))}
          </div>
          <div
            aria-hidden="true"
            className="grid items-center pr-0.5 font-display text-[10px] leading-none font-bold text-[var(--board-hull)] sm:text-xs"
            style={{ gridTemplateRows: `repeat(${SIZE}, 1fr)` }}
          >
            {ROW_LETTERS.map((letter) => (
              <span key={letter}>{letter}</span>
            ))}
          </div>
          <div
            className="relative aspect-square overflow-hidden rounded-[var(--radius-xs)]"
            style={{
              backgroundColor: "var(--board-hole)",
              backgroundImage: GRID_LINES,
              backgroundSize: `${100 / SIZE}% ${100 / SIZE}%`,
            }}
            onPointerLeave={onHover && (() => onHover(null))}
          >
            {lastShot !== null && (
              <span
                aria-hidden="true"
                className="absolute bg-[var(--board-mark)]"
                style={box(
                  { row: Math.floor(lastShot / SIZE), col: lastShot % SIZE, vertical: false },
                  1,
                )}
              />
            )}
            {hulls.map((spec) => (
              <Hull key={spec.key} spec={spec} />
            ))}
            <div
              className="absolute inset-0 grid"
              style={{
                gridTemplateColumns: `repeat(${SIZE}, 1fr)`,
                gridTemplateRows: `repeat(${SIZE}, 1fr)`,
              }}
            >
              {Array.from({ length: CELLS }, (_, square) => {
                const { label: name, active, peg } = cell(square);
                return (
                  <button
                    key={square}
                    type="button"
                    disabled={!active && lockedAs === "disabled"}
                    aria-disabled={!active && lockedAs === "aria" ? true : undefined}
                    aria-label={name}
                    onClick={active ? () => onCell?.(square) : undefined}
                    onPointerEnter={onHover && (() => onHover(square))}
                    onFocus={onHover && (() => onHover(square))}
                    className={`group relative flex min-w-0 items-center justify-center border-none bg-transparent p-0 focus-visible:z-10 focus-visible:outline-offset-[-3px] disabled:cursor-default ${
                      active ? "cursor-pointer" : "cursor-default"
                    }`}
                  >
                    {peg && <Peg hit={peg.hit} landing={square === lastShot} />}
                    {crosshair && active && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-[18%] rounded-full border-2 border-[var(--accent)] opacity-0 shadow-[var(--glow-accent)] transition-[opacity,scale] duration-[var(--dur-fast)] ease-[var(--ease-spring)] group-hover:scale-110 group-hover:opacity-100 group-focus-visible:opacity-100"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {footer}
    </section>
  );
}
