import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { DailyUiProps } from "../../shared/protocol";
import { COLS, MINES, NEIGHBOURS, ROWS, step } from "./game";
import type { MinesweeperAction, MinesweeperView, Square } from "./game";
import type strings from "./locales/en.json";

declare module "i18next" {
  interface ResourceNamespaceMap {
    minesweeper: typeof strings;
  }
}

// The minefield: a 10×12 grid of squares and a flag switch. A tap opens a
// square, and a tap on a number whose mines are all flagged opens the rest
// around it. A long press, a right-click or the switch plants a flag. Every
// move goes to the server, which alone knows where the mines are, so a square
// opens once its move lands.
//
// The grid is an ARIA grid with one tab stop, the selected square, and the
// arrow keys move it; Space or Enter opens the square and F flags it. Each
// square's accessible name says what it shows, since a number's colour and a
// flag's shape are nothing to a screen reader.

// A square's element, as far as moving focus to it goes. Kept as `unknown`
// and narrowed here: the Worker's type-check of this file has an element type
// with no `focus()`.
interface Focusable {
  focus(): void;
}

const ARROWS: Record<string, [dRow: number, dCol: number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

// How long a finger rests on a square before it plants a flag there.
const LONG_PRESS_MS = 400;

// Each number in a colour of its own, the way every minefield draws them, all
// from the board's own tokens so they read the same in both themes. The digit,
// not the colour, is what says how many.
const NUMBER_COLOUR: Record<number, string> = {
  1: "var(--tile-8)",
  2: "var(--tile-32)",
  3: "var(--tile-1024)",
  4: "var(--tile-4)",
  5: "var(--tile-256)",
  6: "var(--tile-16)",
  7: "var(--tile-2048)",
  8: "var(--board-hull)",
};

// A hidden square stands up out of the well, lit along its top edge; an open
// one is sunk into it.
const RAISED = {
  background: "color-mix(in oklab, var(--board-mark) 55%, var(--board-rim))",
  boxShadow:
    "inset 0 0.4cqw 0 color-mix(in oklab, var(--board-peg) 30%, transparent), inset 0 -0.5cqw 0 color-mix(in oklab, var(--board-hole) 55%, transparent)",
} as const;
const SUNK = {
  background: "var(--board-hole)",
  boxShadow: "var(--shadow-inset)",
} as const;
const BLAST = {
  background: "var(--seat-1)",
  boxShadow: "0 0 2.4cqw var(--seat-1)",
} as const;

const TOGGLE =
  "flex h-11 cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-pill)] border px-4 text-sm font-bold text-[var(--text-primary)] shadow-[var(--edge-highlight)] transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] touch-manipulation not-disabled:hover:scale-105 not-disabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-40";
const TOGGLE_PLAIN = "border-[var(--border-subtle)] bg-[var(--surface-2)]";
const TOGGLE_PRESSED = "border-[var(--border-accent)] bg-[var(--accent-soft)]";

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

function FlagGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        d="M8.5 4v15.5M5 19.5h7.5"
        fill="none"
        stroke="var(--board-peg)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path d="M9.5 4.2 19 8.2l-9.5 4z" fill="var(--seat-1)" strokeLinejoin="round" />
    </svg>
  );
}

function MineGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[72%]">
      <path
        d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"
        stroke="var(--seat-1-contrast)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="6" fill="var(--seat-1-contrast)" />
      <circle cx="10" cy="10" r="1.7" fill="var(--board-peg)" />
    </svg>
  );
}

// What the board asks for: the tap's action on a square, and a flag's.
interface Actions {
  open(cell: number): void;
  toggleFlag(cell: number): void;
}

// A finger resting on a square: the timer that will flag it, and whether it
// already has, so the tap that follows the press does not open it as well.
interface Press {
  cell: number;
  timer: ReturnType<typeof setTimeout> | null;
  flagged: boolean;
}

export default function MinesweeperUi({ view, status, send }: DailyUiProps) {
  const { t, i18n } = useTranslation("minesweeper");
  const v = view as MinesweeperView | null;
  const over = v !== null && (v.clearedAt !== null || v.blast !== null);
  const playable = status === "active" && v !== null && !over;
  const now = useNow(playable);
  const language = i18n.resolvedLanguage ?? "en";

  const [selected, setSelected] = useState(0);
  // Whether the selection was last moved from the keyboard. Only then is it
  // ringed: a ring left on the square a mouse last clicked marks nothing.
  const [keyboard, setKeyboard] = useState(false);
  const [flagMode, setFlagMode] = useState(false);
  const cells = useRef<unknown[]>([]);
  const press = useRef<Press | null>(null);
  // Whether the pointer that last touched the board was a mouse. A long press
  // on a phone can raise a context menu too, and the press's own timer has
  // flagged that square already.
  const mouse = useRef(true);

  // A long press's timer outlives the render that set it; this keeps it
  // acting on the board as it is now.
  const act = useRef<Actions | null>(null);

  useEffect(
    () => () => {
      if (press.current?.timer) clearTimeout(press.current.timer);
    },
    [],
  );

  if (!v) {
    return <p className="m-0 text-[var(--text-muted)]">{t("loading")}</p>;
  }

  const squares = v.squares;
  const flags = squares.filter((square) => square === "flag").length;
  // The clear squares still shut: every square not yet open, less the mines.
  const left = squares.filter((square) => typeof square !== "number").length - MINES;

  const move = (action: MinesweeperAction) => {
    if (playable) send(action);
  };
  const actions: Actions = {
    open(cell) {
      const square = squares[cell];
      if (square === "hidden") {
        move(flagMode ? { t: "flag", cell, on: true } : { t: "reveal", cell });
      } else if (square === "flag") {
        if (flagMode) move({ t: "flag", cell, on: false });
      } else if (typeof square === "number" && square > 0) {
        const around = NEIGHBOURS[cell];
        const flagged = around.filter((other) => squares[other] === "flag").length;
        const shut = around.some((other) => squares[other] === "hidden");
        if (flagged === square && shut) move({ t: "chord", cell });
      }
    },
    toggleFlag(cell) {
      const square = squares[cell];
      if (square === "hidden" || square === "flag") {
        move({ t: "flag", cell, on: square === "hidden" });
      }
    },
  };
  act.current = actions;

  const letGo = () => {
    const held = press.current;
    if (held?.timer) {
      clearTimeout(held.timer);
      held.timer = null;
    }
  };

  const count = new Intl.NumberFormat(language);
  const elapsed =
    v.clearedAt !== null
      ? v.clearedAt - v.startedAt
      : v.blast !== null
        ? v.blast.at - v.startedAt
        : status === "active"
          ? Math.max(0, now - v.startedAt)
          : null;
  const stats: [key: "time" | "mines" | "moves", value: string][] = [
    ["time", elapsed !== null ? clock(elapsed) : "–"],
    ["mines", count.format(MINES - flags)],
    ["moves", count.format(v.moves)],
  ];

  const contentOf = (square: Square): string => {
    if (square === "hidden") return t("cell.hidden");
    if (square === "flag") return t("cell.flag");
    if (square === "mine") return t("cell.mine");
    return square === 0 ? t("cell.clear") : t("cell.number", { count: square });
  };

  const message =
    v.clearedAt !== null
      ? null
      : v.blast !== null
        ? t("blast")
        : status === "done"
          ? t("ended")
          : v.moves === 0
            ? t("hint")
            : null;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4">
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
              actions.open(selected);
            } else if (event.key === "f" || event.key === "F") {
              actions.toggleFlag(selected);
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
                const square = squares[cell];
                const open = typeof square === "number";
                const ringed = keyboard && cell === selected;
                return (
                  <div
                    key={col}
                    ref={(element) => {
                      cells.current[cell] = element;
                    }}
                    role="gridcell"
                    tabIndex={cell === selected ? 0 : -1}
                    aria-selected={cell === selected}
                    aria-label={t("cell.label", {
                      row: row + 1,
                      col: col + 1,
                      content: contentOf(square),
                    })}
                    onFocus={() => setSelected(cell)}
                    onPointerDown={(event) => {
                      letGo();
                      press.current = null;
                      mouse.current = event.pointerType === "mouse";
                      setKeyboard(false);
                      if (mouse.current || !playable) return;
                      const held: Press = { cell, timer: null, flagged: false };
                      held.timer = setTimeout(() => {
                        held.timer = null;
                        held.flagged = true;
                        act.current?.toggleFlag(cell);
                      }, LONG_PRESS_MS);
                      press.current = held;
                    }}
                    onPointerUp={letGo}
                    onPointerLeave={letGo}
                    onPointerCancel={() => {
                      letGo();
                      press.current = null;
                    }}
                    onClick={() => {
                      const held = press.current;
                      press.current = null;
                      setSelected(cell);
                      if (held?.cell === cell && held.flagged) return;
                      actions.open(cell);
                    }}
                    onContextMenu={(event) => {
                      if (!playable) return;
                      event.preventDefault();
                      if (!mouse.current) return;
                      setSelected(cell);
                      actions.toggleFlag(cell);
                    }}
                    className={`flex aspect-square min-w-0 flex-1 items-center justify-center transition-[filter] duration-[var(--dur-fast)] touch-manipulation ${
                      playable && !open ? "cursor-pointer hover:brightness-125" : ""
                    }`}
                    style={{
                      ...(square === "mine" ? BLAST : open ? SUNK : RAISED),
                      // Inline, so they win over the app-wide focus ring, which would
                      // spill onto the neighbouring squares.
                      borderRadius: "1cqw",
                      outline: ringed ? "2px solid var(--board-peg)" : "none",
                      outlineOffset: "-2px",
                    }}
                  >
                    {typeof square === "number" ? (
                      square > 0 && (
                        <span
                          aria-hidden="true"
                          className="animate-[party-tile-spawn_var(--dur-fast)_var(--ease-out)_both] font-display leading-none font-bold tabular-nums"
                          style={{ fontSize: "5.4cqw", color: NUMBER_COLOUR[square] }}
                        >
                          {square}
                        </span>
                      )
                    ) : square === "flag" ? (
                      <span
                        key="flag"
                        className="flex size-full animate-[party-piece-land_var(--dur-base)_var(--ease-spring)_both] items-center justify-center"
                      >
                        <FlagGlyph className="size-[72%]" />
                      </span>
                    ) : square === "mine" ? (
                      <span className="flex size-full animate-[party-tile-merge_var(--dur-slow)_var(--ease-bounce)_2] items-center justify-center">
                        <MineGlyph />
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        aria-pressed={flagMode}
        disabled={!playable}
        onClick={() => setFlagMode((on) => !on)}
        className={`${TOGGLE} ${flagMode ? TOGGLE_PRESSED : TOGGLE_PLAIN}`}
      >
        <FlagGlyph className="size-5" />
        {t("flag.mode")}
        <span
          aria-hidden="true"
          className="rounded-[var(--radius-pill)] px-1.5 py-px text-[0.65rem] font-bold uppercase"
          style={
            flagMode
              ? { background: "var(--accent)", color: "var(--text-on-accent)" }
              : { background: "var(--surface-3)", color: "var(--text-muted)" }
          }
        >
          {flagMode ? t("flag.on") : t("flag.off")}
        </span>
      </button>

      {v.clearedAt !== null && elapsed !== null && (
        <p className="m-0 animate-[party-celebrate_var(--dur-slow)_var(--ease-bounce)_2] rounded-[var(--radius-pill)] px-4 py-1.5 text-sm font-bold text-[var(--tile-ink)] [background:var(--tile-32)]">
          {t("cleared", { time: clock(elapsed) })}
        </p>
      )}
      {message && (
        <p
          className={`m-0 text-center text-sm font-semibold ${
            v.blast !== null ? "text-[var(--danger-fg)]" : "text-[var(--text-secondary)]"
          }`}
        >
          {message}
        </p>
      )}
      <p role="status" className="sr-only">
        {v.clearedAt !== null && elapsed !== null
          ? t("cleared", { time: clock(elapsed) })
          : v.blast !== null
            ? t("blast")
            : t("announce", { count: left })}
      </p>
    </div>
  );
}
