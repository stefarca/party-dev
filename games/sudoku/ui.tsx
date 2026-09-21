import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { DailyUiProps } from "../../shared/protocol";
import { BOX, SIZE, boxOf, clashes, colOf, digitsIn, rowOf, step, valuesOf } from "./game";
import type { SudokuView } from "./game";
import type strings from "./locales/en.json";

declare module "i18next" {
  interface ResourceNamespaceMap {
    sudoku: typeof strings;
  }
}

// The sudoku board: a 9×9 grid of squares, a pad of the nine digits, and a
// notes switch. A player picks a square, then a digit, and every entry goes
// to the server; the board shows the run as the server last returned it, so
// a digit appears once its move lands.
//
// The grid is an ARIA grid with one tab stop, the selected square, and the
// arrow keys move it. Each square's accessible name says what is in it,
// whether it was given, and whether it clashes, since those are drawn in
// colour and weight a screen reader cannot see.

// The one listener that has to live on the window: a digit typed anywhere on
// the page goes into the selected square, the way a sudoku board behaves.
// Reached through a narrow type of its own rather than `window`, since the
// Worker's type-check of this file has no DOM types to offer.
interface KeyLike {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  defaultPrevented: boolean;
  target: unknown;
  preventDefault(): void;
}

interface KeyTarget {
  addEventListener(type: "keydown", listener: (event: KeyLike) => void): void;
  removeEventListener(type: "keydown", listener: (event: KeyLike) => void): void;
}

// A square's element, as far as moving focus to it goes. Kept as `unknown`
// and narrowed here: the Worker's type-check of this file has an element type
// with no `focus()`.
interface Focusable {
  focus(): void;
}

// What a key, a pad button or the grid asks of the board.
interface Actions {
  enter(digit: number): void;
  erase(): void;
  // `focus` moves focus along with the selection, for arrows pressed in the grid.
  move(dRow: number, dCol: number, focus: boolean): void;
  toggleNotes(): void;
}

// Keys typed into a field, or pressed inside a dialog, are someone else's.
// Shift is allowed: some keyboards need it to type a digit at all.
const NOT_FOR_THE_BOARD =
  "input, textarea, select, [contenteditable], [role='dialog'], [role='alertdialog']";

function isForTheBoard(event: KeyLike): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false;
  const target = event.target as { closest?: (selector: string) => unknown } | null;
  return !target?.closest?.(NOT_FOR_THE_BOARD);
}

const ARROWS: Record<string, [dRow: number, dCol: number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

const ERASE_KEYS = new Set(["Backspace", "Delete", "0"]);

const DIGITS = Array.from({ length: SIZE }, (_, i) => i + 1);

// A square's fill: the plain well, a tint for the row, column and box of the
// selected square, and a stronger one for every square holding the selected
// digit (and for the selected square itself, which also gets a ring). Mixed
// from the board's own tokens, which are the same in both themes.
const FILL = {
  plain: "var(--board-hole)",
  peer: "color-mix(in oklab, var(--board-mark) 25%, var(--board-hole))",
  same: "color-mix(in oklab, var(--board-mark) 55%, var(--board-hole))",
} as const;

// The wider gap that sets the 3×3 boxes apart, before the first row and
// column of each box but the first. Written out in full: Tailwind only emits
// class names it can read in the source.
const BOX_GAP_ROW = "mt-[1.5cqw]";
const BOX_GAP_COL = "ml-[1.5cqw]";

const PAD_BUTTON =
  "flex cursor-pointer items-center justify-center border text-[var(--text-primary)] shadow-[var(--edge-highlight)] transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] touch-manipulation not-disabled:hover:scale-105 not-disabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-40";
const PAD_PLAIN = "border-[var(--border-subtle)] bg-[var(--surface-2)]";
const PAD_PRESSED = "border-[var(--border-accent)] bg-[var(--accent-soft)]";

// A time as a stopwatch reads one: "4:05", "1:02:09".
function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

// The current time, once a second while `ticking`.
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

function Notes({ mask, highlight }: { mask: number; highlight: number | null }) {
  return (
    <span aria-hidden="true" className="grid size-full grid-cols-3 grid-rows-3 p-[0.4cqw]">
      {DIGITS.map((digit) => {
        const shown = (mask & (1 << (digit - 1))) !== 0;
        const lit = shown && digit === highlight;
        return (
          <span
            key={digit}
            className={`flex items-center justify-center font-display leading-none tabular-nums ${
              lit ? "font-bold" : "font-medium"
            }`}
            style={{
              fontSize: "2.4cqw",
              color: lit ? "var(--board-peg)" : "var(--board-hull)",
            }}
          >
            {shown ? digit : ""}
          </span>
        );
      })}
    </span>
  );
}

export default function SudokuUi({ view, status, send }: DailyUiProps) {
  const { t, i18n } = useTranslation("sudoku");
  const v = view as SudokuView | null;
  const solved = v?.solvedAt != null;
  const playable = status === "active" && v !== null && !solved;
  const now = useNow(playable);
  const language = i18n.resolvedLanguage ?? "en";

  const [selected, setSelected] = useState<number | null>(null);
  const [notesMode, setNotesMode] = useState(false);
  const cells = useRef<unknown[]>([]);

  // The window's key listener outlives renders; this keeps it acting on the
  // board as it is now.
  const act = useRef<Actions | null>(null);

  useEffect(() => {
    if (!playable) return;
    const target = globalThis as unknown as KeyTarget;
    function onKey(event: KeyLike) {
      if (!isForTheBoard(event)) return;
      const arrow = ARROWS[event.key];
      const board = act.current;
      if (!board) return;
      if (/^[1-9]$/.test(event.key)) board.enter(Number(event.key));
      else if (ERASE_KEYS.has(event.key)) board.erase();
      else if (event.key === "n" || event.key === "N") board.toggleNotes();
      // Arrows pressed inside the grid are the grid's own (below); these are
      // the ones pressed with focus elsewhere, on the pad say.
      else if (arrow) board.move(arrow[0], arrow[1], false);
      else return;
      event.preventDefault();
    }
    target.addEventListener("keydown", onKey);
    return () => target.removeEventListener("keydown", onKey);
  }, [playable]);

  if (!v) {
    return <p className="m-0 text-[var(--text-muted)]">{t("loading")}</p>;
  }

  const values = valuesOf(v);
  const clash = clashes(values);
  const open = selected !== null && v.givens[selected] === 0;
  const canEnter = playable && open && !(notesMode && v.entries[selected] !== 0);
  const canErase = playable && open && (v.entries[selected] !== 0 || v.notes[selected] !== 0);
  const selectedDigit = selected !== null && values[selected] !== 0 ? values[selected] : null;
  const left = values.filter((digit) => digit === 0).length;
  const anyClash = clash.some(Boolean);
  const remaining = (digit: number) =>
    Math.max(0, SIZE - values.filter((value) => value === digit).length);

  const actions: Actions = {
    enter(digit) {
      if (!playable || selected === null || v.givens[selected] !== 0) return;
      if (notesMode) {
        if (v.entries[selected] === 0) send({ t: "note", cell: selected, digit });
      } else {
        send({ t: "set", cell: selected, digit });
      }
    },
    erase() {
      if (canErase && selected !== null) send({ t: "clear", cell: selected });
    },
    move(dRow, dCol, focus) {
      const next = selected === null ? 0 : step(selected, dRow, dCol);
      setSelected(next);
      if (focus) (cells.current[next] as Focusable | undefined)?.focus();
    },
    toggleNotes() {
      if (playable) setNotesMode((on) => !on);
    },
  };
  act.current = actions;

  const count = new Intl.NumberFormat(language);
  const elapsed =
    v.solvedAt !== null
      ? v.solvedAt - v.startedAt
      : status === "active"
        ? Math.max(0, now - v.startedAt)
        : null;
  const stats: [key: "time" | "left" | "moves", value: string][] = [
    ["time", elapsed !== null ? clock(elapsed) : "–"],
    ["left", count.format(left)],
    ["moves", count.format(v.moves)],
  ];

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
  const message = solved
    ? null
    : status === "done"
      ? t("ended")
      : left === 0 && anyClash
        ? t("full")
        : v.moves === 0
          ? t("hint")
          : null;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4">
      <dl aria-label={t("stats.label")} className="m-0 grid w-full grid-cols-3 gap-2">
        {stats.map(([key, value]) => (
          <div
            key={key}
            className="flex flex-col items-center rounded-[var(--radius-md)] bg-[var(--surface-2)] px-2 py-2 shadow-[var(--edge-highlight)]"
          >
            <dt className="sr-only">{t(`stats.${key}`)}</dt>
            {/* The word and the number share one element, with a real space between them, so
                the cell reads as "Moves 12" to a test as well as to the eye. */}
            <dd className="m-0 flex flex-col items-center gap-0.5">
              <span
                aria-hidden="true"
                className="text-[0.65rem] font-bold tracking-[0.12em] text-[var(--text-muted)] uppercase"
              >
                {t(`stats.${key}`)}
              </span>{" "}
              <span className="font-display text-xl font-bold text-[var(--text-primary)] tabular-nums sm:text-2xl">
                {value}
              </span>
            </dd>
          </div>
        ))}
      </dl>

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
            actions.move(arrow[0], arrow[1], true);
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
                const given = v.givens[cell];
                const digit = values[cell];
                const isSelected = cell === selected;
                return (
                  <div
                    key={col}
                    ref={(element) => {
                      cells.current[cell] = element;
                    }}
                    role="gridcell"
                    tabIndex={cell === focusable ? 0 : -1}
                    aria-selected={isSelected}
                    aria-readonly={given !== 0 || undefined}
                    aria-label={cellLabel(cell)}
                    onFocus={() => setSelected(cell)}
                    onClick={() => setSelected(cell)}
                    className={`flex aspect-square min-w-0 flex-1 cursor-pointer items-center justify-center shadow-[var(--shadow-inset)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] touch-manipulation ${
                      col > 0 && col % BOX === 0 ? BOX_GAP_COL : ""
                    }`}
                    style={{
                      background: fillOf(cell),
                      // Inline, so they win over the app-wide focus ring, which would
                      // spill onto the neighbouring squares. In the grid, the focused
                      // square is always the selected one, and this ring marks both.
                      borderRadius: "0.9cqw",
                      outline: isSelected ? "2px solid var(--board-peg)" : "none",
                      outlineOffset: "-2px",
                    }}
                  >
                    {digit !== 0 ? (
                      <span
                        // Keyed by digit, so a new entry mounts afresh and pops in.
                        key={digit}
                        aria-hidden="true"
                        className={`font-display leading-none tabular-nums ${
                          given
                            ? "font-bold"
                            : "animate-[party-tile-spawn_var(--dur-base)_var(--ease-spring)_both] font-medium"
                        } ${
                          clash[cell]
                            ? "underline decoration-wavy decoration-2 underline-offset-[0.8cqw]"
                            : ""
                        }`}
                        style={{
                          fontSize: "6.2cqw",
                          color: clash[cell]
                            ? "var(--tile-1024)"
                            : given
                              ? "var(--board-peg)"
                              : "var(--tile-8)",
                        }}
                      >
                        {digit}
                      </span>
                    ) : v.notes[cell] !== 0 ? (
                      <Notes mask={v.notes[cell]} highlight={selectedDigit} />
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div role="group" aria-label={t("pad.label")} className="grid w-full grid-cols-9 gap-1.5">
        {DIGITS.map((digit) => {
          const toGo = remaining(digit);
          return (
            <button
              key={digit}
              type="button"
              aria-label={t("pad.digit", { digit, count: toGo })}
              disabled={!canEnter}
              onClick={() => actions.enter(digit)}
              className={`${PAD_BUTTON} ${PAD_PLAIN} h-14 flex-col gap-0.5 rounded-[var(--radius-sm)] px-0 ${
                toGo === 0 ? "opacity-60" : ""
              }`}
            >
              <span
                aria-hidden="true"
                className={`font-display leading-none tabular-nums ${
                  notesMode
                    ? "text-base font-medium text-[var(--text-secondary)]"
                    : "text-xl font-bold"
                }`}
              >
                {digit}
              </span>
              <span
                aria-hidden="true"
                className="text-[0.6rem] leading-none font-bold text-[var(--text-muted)] tabular-nums"
              >
                {toGo}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          aria-pressed={notesMode}
          disabled={!playable}
          onClick={() => actions.toggleNotes()}
          className={`${PAD_BUTTON} ${notesMode ? PAD_PRESSED : PAD_PLAIN} h-11 gap-2 rounded-[var(--radius-pill)] px-4 text-sm font-bold`}
        >
          <span aria-hidden="true">✎</span>
          {t("pad.notes")}
          <span
            aria-hidden="true"
            className="rounded-[var(--radius-pill)] px-1.5 py-px text-[0.65rem] font-bold uppercase"
            style={
              notesMode
                ? { background: "var(--accent)", color: "var(--text-on-accent)" }
                : { background: "var(--surface-3)", color: "var(--text-muted)" }
            }
          >
            {notesMode ? t("pad.on") : t("pad.off")}
          </span>
        </button>
        <button
          type="button"
          disabled={!canErase}
          onClick={() => actions.erase()}
          className={`${PAD_BUTTON} ${PAD_PLAIN} h-11 gap-2 rounded-[var(--radius-pill)] px-4 text-sm font-bold`}
        >
          <span aria-hidden="true">⌫</span>
          {t("pad.erase")}
        </button>
      </div>

      {solved && elapsed !== null && (
        <p className="m-0 animate-[party-celebrate_var(--dur-slow)_var(--ease-bounce)_2] rounded-[var(--radius-pill)] px-4 py-1.5 text-sm font-bold text-[var(--tile-ink)] [background:var(--tile-32)]">
          {t("solved", { time: clock(elapsed) })}
        </p>
      )}
      {message && (
        <p className="m-0 text-center text-sm font-semibold text-[var(--text-secondary)]">
          {message}
        </p>
      )}
      <p role="status" className="sr-only">
        {solved && elapsed !== null
          ? t("solved", { time: clock(elapsed) })
          : `${t("announce", { count: left })}${anyClash ? ` ${t("announceClash")}` : ""}`}
      </p>
    </div>
  );
}
