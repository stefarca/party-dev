import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import type { GameUiProps } from "../../shared/protocol";
import { CELLS, SIZE } from "./game";
import type { Cell, Mark } from "./game";
import type strings from "./locales/en.json";

declare module "i18next" {
  interface ResourceNamespaceMap {
    tictactoe: typeof strings;
  }
}

// Tic-tac-toe board. The turn deadline is shown once, generically, by
// `TurnIndicator` in `MatchPage` — no countdown here. The shell
// (`GameSurface`) provides the cabinet; this renders only the board, painted
// with the theme-independent `--board-*` tokens so the marks stay vivid in
// both light and dark mode.

interface TicTacToeView {
  board: Cell[]; // row-major: board[row * SIZE + col]
  players: Record<Mark, string>;
  you: Mark | "spectator";
  turn: Mark | null;
  yourTurn: boolean;
  turnNo: number;
  lastMove: number | null;
  winner: Mark | null;
  winLine: number[] | null;
  draw: boolean;
}

// Colour is never the only signal: X and O are different shapes, and every
// square's aria-label names the mark in it.
const MARK_COLOR: Record<Mark, string> = { X: "var(--seat-1)", O: "var(--seat-2)" };

// The newest mark draws itself in like a pen stroke; the second stroke of an
// X starts a beat after the first.
const DRAW_IN = "animate-[party-stroke-draw_var(--dur-slow)_var(--ease-out)_both]";
const DRAW_IN_SECOND = "animate-[party-stroke-draw_var(--dur-slow)_var(--ease-out)_140ms_both]";

function MarkGlyph({
  mark,
  drawIn = false,
  className,
  style,
}: {
  mark: Mark;
  drawIn?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.4}
      strokeLinecap="round"
      className={className}
      style={{ color: MARK_COLOR[mark], ...style }}
      aria-hidden="true"
    >
      {mark === "X" ? (
        <>
          <path
            d="M6 6 18 18"
            pathLength={1}
            strokeDasharray={1}
            className={drawIn ? DRAW_IN : undefined}
          />
          <path
            d="M18 6 6 18"
            pathLength={1}
            strokeDasharray={1}
            className={drawIn ? DRAW_IN_SECOND : undefined}
          />
        </>
      ) : (
        // Rotated so the stroke starts at twelve o'clock rather than three.
        <circle
          cx="12"
          cy="12"
          r="6.5"
          transform="rotate(-90 12 12)"
          pathLength={1}
          strokeDasharray={1}
          className={drawIn ? DRAW_IN : undefined}
        />
      )}
    </svg>
  );
}

function SeatBadge({
  mark,
  name,
  isYou,
  isTurn,
}: {
  mark: Mark;
  name: string;
  isYou: boolean;
  isTurn: boolean;
}) {
  const { t } = useTranslation("tictactoe");
  return (
    <div
      className={`flex items-center gap-2 rounded-[var(--radius-pill)] border-2 px-3 py-1.5 transition-[transform,border-color] duration-[var(--dur-base)] ease-[var(--ease-spring)] ${
        isTurn ? "scale-105 border-[var(--border-accent)]" : "border-transparent"
      }`}
      style={{ background: isTurn ? "var(--accent-soft)" : "var(--surface-1)" }}
    >
      <span
        aria-hidden="true"
        className="flex size-7 flex-none items-center justify-center rounded-full bg-[var(--board-hole)] shadow-[var(--shadow-1)]"
      >
        <MarkGlyph mark={mark} className="size-5" />
      </span>
      <span
        className={`truncate text-sm ${isYou ? "font-bold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}
      >
        {isYou ? t("you", { name }) : name}
      </span>
    </div>
  );
}

export default function TicTacToeUi({ view, players, result, send }: GameUiProps) {
  const { t } = useTranslation("tictactoe");
  const v = view as TicTacToeView | null;

  if (!v) {
    return <p className="m-0 text-[var(--text-muted)]">{t("loading")}</p>;
  }

  const yourMark = v.you === "spectator" ? null : v.you;
  const nameFor = (mark: Mark): string =>
    players.find((p) => p.id === v.players[mark])?.nickname ?? mark;

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
    <div className="flex flex-col gap-4">
      <div className="mx-auto flex w-full max-w-sm flex-wrap items-center justify-center gap-2 sm:justify-between">
        {(["X", "O"] as const).map((mark) => (
          <SeatBadge
            key={mark}
            mark={mark}
            name={nameFor(mark)}
            isYou={v.you === mark}
            isTurn={!result && v.turn === mark}
          />
        ))}
      </div>

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
          const winIndex = v.winLine?.indexOf(i) ?? -1;
          const inWinLine = winIndex >= 0;
          return (
            <button
              key={i}
              type="button"
              disabled={!playable}
              onClick={() => playable && send({ t: "place", cell: i })}
              aria-label={cellLabel(i, cell, playable)}
              className={`group flex aspect-square items-center justify-center rounded-[var(--radius-md)] border-none p-0 transition-[background-color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-default ${
                inWinLine
                  ? "bg-[var(--accent-soft)] ring-3 ring-[var(--accent)] ring-inset"
                  : "bg-[var(--board-hole)] shadow-[var(--shadow-inset)]"
              } ${playable ? "cursor-pointer hover:-translate-y-0.5 hover:bg-[var(--accent-soft)]" : ""}`}
            >
              {cell !== null ? (
                <MarkGlyph
                  mark={cell}
                  drawIn={i === v.lastMove}
                  className="size-3/5"
                  style={
                    inWinLine
                      ? {
                          animation: "party-celebrate 1.6s var(--ease-spring) infinite",
                          animationDelay: `${winIndex * 120}ms`,
                        }
                      : undefined
                  }
                />
              ) : (
                playable &&
                yourMark && (
                  // A faint preview of your own mark on the square under the
                  // pointer or keyboard focus.
                  <MarkGlyph
                    mark={yourMark}
                    className="size-3/5 opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover:opacity-35 group-focus-visible:opacity-35"
                  />
                )
              )}
            </button>
          );
        })}
      </div>

      {!result && (
        <p className="m-0 text-center text-sm font-semibold text-[var(--text-secondary)]">
          {v.yourTurn
            ? t("status.yourTurn", { mark: yourMark })
            : v.turn
              ? t("status.waitingFor", { name: nameFor(v.turn) })
              : t("status.finished")}
        </p>
      )}
    </div>
  );
}
