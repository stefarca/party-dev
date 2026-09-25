import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { DailyUiProps } from "../../shared/protocol";
import { COLORS, MAX_GUESSES, PEGS, clock } from "./game";
import type { Guess, MastermindView } from "./game";
import type strings from "./locales/en.json";

declare module "i18next" {
  interface ResourceNamespaceMap {
    mastermind: typeof strings;
  }
}

// The Mastermind board: seven rows of five holes, one per guess, each with
// its marks beside it, and a palette of the seven colours below. A player
// fills the current row from the palette, then checks it; the row shows the
// guess as the server marked it once the move lands.
//
// Every colour is also a symbol, so no peg is told apart by colour alone, and
// the marks are a filled peg and a hollow ring, told apart by shape. Each
// row's accessible name spells both out.

// The one listener that has to live on the window: a colour picked by its
// number anywhere on the page goes into the current row. Reached through a
// narrow type of its own rather than `window`, since the Worker's type-check
// of this file has no DOM types to offer.
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

// What a key or a button asks of the board.
interface Actions {
  pick(color: number): void;
  erase(): void;
  check(): void;
}

// Keys typed into a field, or pressed inside a dialog, are someone else's.
const NOT_FOR_THE_BOARD =
  "input, textarea, select, [contenteditable], [role='dialog'], [role='alertdialog']";
// Enter on a focused button presses that button, and must not check as well.
const PRESSES_ENTER = "button, a, [role='button']";

function closest(event: KeyLike, selector: string): boolean {
  const target = event.target as { closest?: (selector: string) => unknown } | null;
  return Boolean(target?.closest?.(selector));
}

function isForTheBoard(event: KeyLike): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false;
  return !closest(event, NOT_FOR_THE_BOARD);
}

const PALETTE = Array.from({ length: COLORS }, (_, color) => color);

// Written out in full: Tailwind only emits class names it can read in the
// source, and the i18n keys are type-checked against the English file.
const FILL = [
  "var(--code-1)",
  "var(--code-2)",
  "var(--code-3)",
  "var(--code-4)",
  "var(--code-5)",
  "var(--code-6)",
  "var(--code-7)",
] as const;
const INK = [
  "var(--code-1-ink)",
  "var(--code-2-ink)",
  "var(--code-3-ink)",
  "var(--code-4-ink)",
  "var(--code-5-ink)",
  "var(--code-6-ink)",
  "var(--code-7-ink)",
] as const;
const NAME = ["color.0", "color.1", "color.2", "color.3", "color.4", "color.5", "color.6"] as const;

// Each colour's symbol, inside a 24×24 box: a circle, a square, a triangle, a
// diamond, a star, a cross and a heart.
function Glyph({ color }: { color: number }) {
  switch (color) {
    case 0:
      return <circle cx="12" cy="12" r="6" />;
    case 1:
      return <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />;
    case 2:
      return <path d="M12 5 19.5 18.5h-15z" />;
    case 3:
      return <path d="M12 4 20 12 12 20 4 12z" />;
    case 4:
      return (
        <path d="M12 4.6 14.1 9.7 19.6 10.1 15.4 13.7 16.7 19.1 12 16.2 7.3 19.1 8.6 13.7 4.4 10.1 9.9 9.7z" />
      );
    case 5:
      return <path d="M9.6 5h4.8v4.6H19v4.8h-4.6V19H9.6v-4.6H5V9.6h4.6z" />;
    default:
      return <path d="M12 19.2 5.3 12.6a4 4 0 0 1 6.7-5.1 4 4 0 0 1 6.7 5.1z" />;
  }
}

// One code peg, filling whatever box it is given.
function Peg({ color, pop = false }: { color: number; pop?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`size-full rounded-full ${
        pop ? "animate-[party-tile-spawn_var(--dur-base)_var(--ease-spring)_both]" : ""
      }`}
      style={{ background: FILL[color], boxShadow: "var(--game-piece-shadow)" }}
    >
      <g fill={INK[color]}>
        <Glyph color={color} />
      </g>
    </svg>
  );
}

// An empty hole in the board.
function Hole() {
  return (
    <span
      aria-hidden="true"
      className="block size-full rounded-full shadow-[var(--shadow-inset)]"
      style={{ background: "var(--board-hole)" }}
    />
  );
}

// A row's marks, one small peg each: filled for a peg in place, a ring for
// one misplaced, an empty hole for the rest.
function Marks({ guess }: { guess: Guess | null }) {
  const exact = guess?.exact ?? 0;
  const near = guess?.near ?? 0;
  return (
    <span aria-hidden="true" className="grid w-[15cqw] flex-none grid-cols-3 gap-[1cqw]">
      {Array.from({ length: PEGS }, (_, i) => (
        <span
          key={i}
          className="aspect-square rounded-full"
          style={
            i < exact
              ? { background: "var(--board-peg)" }
              : i < exact + near
                ? { border: "0.9cqw solid var(--board-peg)", background: "var(--board-hole)" }
                : { background: "var(--board-hole)", boxShadow: "var(--shadow-inset)" }
          }
        />
      ))}
    </span>
  );
}

const ROW = "flex items-center gap-[2cqw] rounded-[2cqw] px-[2cqw] py-[1cqw]";
const HOLES = "grid flex-1 grid-cols-5 gap-[2cqw]";
const NUMBER =
  "w-[5cqw] flex-none text-center font-display text-[3.6cqw] font-bold tabular-nums text-[var(--board-hull)]";

const BUTTON =
  "flex cursor-pointer items-center justify-center border text-[var(--text-primary)] shadow-[var(--edge-highlight)] transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] touch-manipulation not-disabled:hover:scale-105 not-disabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-40";
const PLAIN = "border-[var(--border-subtle)] bg-[var(--surface-2)]";
const PRIMARY = "border-transparent bg-[var(--accent)] text-[var(--text-on-accent)]";

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

export default function MastermindUi({ view, status, send }: DailyUiProps) {
  const { t, i18n } = useTranslation("mastermind");
  const v = view as MastermindView | null;
  const solved = v?.solvedAt != null;
  const outOfGuesses = !solved && (v?.guesses.length ?? 0) >= MAX_GUESSES;
  const playable = status === "active" && v !== null && !solved && !outOfGuesses;
  const now = useNow(playable);
  const language = i18n.resolvedLanguage ?? "en";

  // The row being built, a colour or null per hole.
  const [draft, setDraft] = useState<(number | null)[]>(() => new Array(PEGS).fill(null));
  // A guess sent but not yet answered, and the view it was sent against. It
  // stands in the current row until any new view arrives: the marked guess,
  // or the run as the server has it after a send that failed.
  const [pending, setPending] = useState<{ pegs: number[]; against: unknown } | null>(null);
  const waiting = pending !== null && pending.against === view;
  const canEdit = playable && !waiting;

  // The window's key listener outlives renders; this keeps it acting on the
  // board as it is now.
  const act = useRef<Actions | null>(null);

  useEffect(() => {
    if (!playable) return;
    const target = globalThis as unknown as KeyTarget;
    function onKey(event: KeyLike) {
      if (!isForTheBoard(event)) return;
      const board = act.current;
      if (!board) return;
      if (/^[1-7]$/.test(event.key)) board.pick(Number(event.key) - 1);
      else if (event.key === "Backspace" || event.key === "Delete") board.erase();
      else if (event.key === "Enter" && !closest(event, PRESSES_ENTER)) board.check();
      else return;
      event.preventDefault();
    }
    target.addEventListener("keydown", onKey);
    return () => target.removeEventListener("keydown", onKey);
  }, [playable]);

  if (!v) {
    return <p className="m-0 text-[var(--text-muted)]">{t("loading")}</p>;
  }

  const full = draft.every((color) => color !== null);
  const used = new Set(draft.filter((color): color is number => color !== null));

  const actions: Actions = {
    pick(color) {
      if (!canEdit || used.has(color)) return;
      const slot = draft.indexOf(null);
      if (slot === -1) return;
      setDraft(draft.map((peg, i) => (i === slot ? color : peg)));
    },
    erase() {
      if (!canEdit) return;
      let last = PEGS - 1;
      while (last >= 0 && draft[last] === null) last--;
      if (last >= 0) setDraft(draft.map((peg, i) => (i === last ? null : peg)));
    },
    check() {
      if (!canEdit || !full) return;
      const pegs = draft as number[];
      send({ t: "guess", pegs });
      setPending({ pegs, against: view });
      setDraft(new Array(PEGS).fill(null));
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
  const stats: [key: "guesses" | "time", value: string][] = [
    ["guesses", `${count.format(v.guesses.length)}/${count.format(MAX_GUESSES)}`],
    ["time", elapsed !== null ? clock(elapsed) : "–"],
  ];

  const colorName = (color: number) => t(NAME[color]);
  const marksOf = (guess: Guess) => t("marks", { exact: guess.exact, near: guess.near });
  const last = v.guesses.at(-1);
  const current = v.guesses.length;
  // Rows after the current one, still empty; the current one too once the run is over.
  const emptyRows = MAX_GUESSES - current - (playable ? 1 : 0);

  const message = solved
    ? null
    : outOfGuesses
      ? t("failed")
      : status === "done"
        ? t("ended")
        : current === 0
          ? t("hint")
          : null;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 sm:max-w-lg">
      <dl aria-label={t("stats.label")} className="m-0 grid w-full grid-cols-2 gap-2">
        {stats.map(([key, value]) => (
          <div
            key={key}
            className="flex flex-col items-center rounded-[var(--radius-md)] bg-[var(--surface-2)] px-2 py-2 shadow-[var(--edge-highlight)]"
          >
            <dt className="sr-only">{t(`stats.${key}`)}</dt>
            {/* The word and the number share one element, with a real space between them, so
                the cell reads as "Guesses 2/7" to a test as well as to the eye. */}
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

      {/* Beside the board from `sm` up, like a peg tray, so it is on the screen with the board;
          below it on a phone. */}
      <div className="flex w-full flex-col items-center gap-4 sm:flex-row sm:items-start sm:justify-center">
        <div className="@container w-full sm:max-w-[22rem]">
          <section
            aria-label={t("board")}
            className="flex w-full flex-col gap-[0.8cqw] rounded-[var(--radius-lg)] border-4 p-[2cqw] shadow-[var(--shadow-inset),var(--shadow-2)] select-none"
            style={{ background: "var(--board-well)", borderColor: "var(--board-rim)" }}
          >
            {current > 0 && (
              <ol
                aria-label={t("guesses")}
                className="m-0 flex list-none flex-col gap-[0.8cqw] p-0"
              >
                {v.guesses.map((guess, index) => (
                  <li
                    key={index}
                    // The row is its name: its pegs and marks are drawn, and hidden from
                    // assistive technology.
                    aria-label={t("guess", {
                      number: index + 1,
                      pegs: guess.pegs.map(colorName).join(", "),
                      marks: marksOf(guess),
                    })}
                    className={ROW}
                    style={
                      guess.exact === PEGS
                        ? { background: "color-mix(in oklab, var(--board-mark) 45%, transparent)" }
                        : undefined
                    }
                  >
                    <span aria-hidden="true" className={NUMBER}>
                      {index + 1}
                    </span>
                    <span aria-hidden="true" className={HOLES}>
                      {guess.pegs.map((color, slot) => (
                        <span key={slot} className="aspect-square">
                          <Peg color={color} pop={index === current - 1} />
                        </span>
                      ))}
                    </span>
                    <Marks guess={guess} />
                  </li>
                ))}
              </ol>
            )}

            {playable && (
              <div
                role="group"
                aria-label={t("draft.label", { number: current + 1, count: MAX_GUESSES })}
                className={ROW}
                style={{
                  background: "color-mix(in oklab, var(--board-mark) 30%, transparent)",
                  outline: "2px solid var(--board-mark)",
                }}
              >
                <span aria-hidden="true" className={NUMBER}>
                  {current + 1}
                </span>
                <span className={HOLES}>
                  {(waiting ? pending.pegs : draft).map((color, slot) => (
                    <button
                      key={slot}
                      type="button"
                      disabled={!canEdit || color === null}
                      aria-label={
                        color === null
                          ? t("draft.empty", { slot: slot + 1 })
                          : t("draft.filled", { slot: slot + 1, color: colorName(color) })
                      }
                      onClick={() => setDraft(draft.map((peg, i) => (i === slot ? null : peg)))}
                      className="aspect-square cursor-pointer rounded-full p-0 touch-manipulation disabled:cursor-default"
                    >
                      {color === null ? <Hole /> : <Peg key={color} color={color} pop />}
                    </button>
                  ))}
                </span>
                <Marks guess={null} />
              </div>
            )}

            {Array.from({ length: Math.max(0, emptyRows) }, (_, i) => (
              <div key={i} aria-hidden="true" className={`${ROW} opacity-60`}>
                <span className={NUMBER}>{current + (playable ? 2 : 1) + i}</span>
                <span className={HOLES}>
                  {Array.from({ length: PEGS }, (_, slot) => (
                    <span key={slot} className="aspect-square">
                      <Hole />
                    </span>
                  ))}
                </span>
                <Marks guess={null} />
              </div>
            ))}
          </section>
        </div>

        <div className="flex w-full flex-col items-center gap-3 sm:w-auto">
          <div
            role="group"
            aria-label={t("palette")}
            className="grid w-full grid-cols-7 gap-1.5 sm:w-[7.5rem] sm:grid-cols-2"
          >
            {PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={colorName(color)}
                disabled={!canEdit || full || used.has(color)}
                onClick={() => actions.pick(color)}
                className={`${BUTTON} ${PLAIN} h-16 flex-col gap-1 rounded-[var(--radius-sm)] px-1 sm:h-14`}
              >
                <span className="block size-9 max-w-full">
                  <Peg color={color} />
                </span>
                <span
                  aria-hidden="true"
                  className="text-[0.6rem] leading-none font-bold text-[var(--text-muted)] tabular-nums"
                >
                  {color + 1}
                </span>
              </button>
            ))}
          </div>

          <div className="flex gap-2 sm:w-full sm:flex-col">
            <button
              type="button"
              disabled={!canEdit || used.size === 0}
              onClick={() => actions.erase()}
              className={`${BUTTON} ${PLAIN} h-11 gap-2 rounded-[var(--radius-pill)] px-4 text-sm font-bold sm:px-2`}
            >
              <span aria-hidden="true">⌫</span>
              {t("erase")}
            </button>
            <button
              type="button"
              disabled={!canEdit || !full}
              onClick={() => actions.check()}
              className={`${BUTTON} ${PRIMARY} h-11 gap-2 rounded-[var(--radius-pill)] px-5 text-sm font-bold sm:px-2`}
            >
              <span aria-hidden="true">✓</span>
              {t("check")}
            </button>
          </div>
        </div>
      </div>

      {/* What the marks mean. Hidden from assistive technology, which reads every row's marks
          as words. Drawn in the text's own colour, since it sits on the page, not the board. */}
      <div
        aria-hidden="true"
        className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs font-semibold text-[var(--text-secondary)]"
      >
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block size-3 rounded-full"
            style={{ background: "var(--text-primary)" }}
          />
          {t("legend.exact")}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block size-3 rounded-full"
            style={{ border: "2px solid var(--text-primary)" }}
          />
          {t("legend.near")}
        </span>
      </div>

      {solved && (
        <p className="m-0 animate-[party-celebrate_var(--dur-slow)_var(--ease-bounce)_2] rounded-[var(--radius-pill)] px-4 py-1.5 text-sm font-bold text-[var(--tile-ink)] [background:var(--tile-32)]">
          {t("solved", { count: current })}
        </p>
      )}
      {message && (
        <p className="m-0 text-center text-sm font-semibold text-[var(--text-secondary)]">
          {message}
        </p>
      )}
      <p role="status" className="sr-only">
        {solved
          ? t("solved", { count: current })
          : last
            ? t("announce", { number: current, marks: marksOf(last) })
            : ""}
      </p>
    </div>
  );
}
