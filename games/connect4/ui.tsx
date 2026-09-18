import { useState } from "react";

import type { GameUiProps } from "../../shared/protocol";
import { COLS, ROWS } from "./game";

// Connect 4 board. No game-specific countdown here — the turn deadline is
// already shown once, generically, by `TurnIndicator` in `MatchPage`;
// duplicating it here would just be two clocks disagreeing by a second.
//
// The shell (`GameSurface`) provides the surrounding cabinet — this
// component renders only the board content that goes inside it. The board
// itself is painted with the theme-independent `--board-*` tokens, so the
// frame stays a dark plastic object and the discs stay vivid in both light
// and dark mode.

type Cell = 0 | 1 | null;

interface Connect4View {
  board: Cell[][]; // board[row][col], row 0 = bottom
  you: 0 | 1 | "spectator";
  yourTurn: boolean;
  turnNo: number;
  lastMove: { col: number; row: number } | null;
  winner: 0 | 1 | null;
  draw: boolean;
  deadline: number | null;
}

// Colour is never the only signal for whose disc is whose: each seat also
// gets a distinct glyph (rendered inside the disc) and an aria-label, for
// the colour-blind coworker in the office.
const SEAT_COLOR: Record<0 | 1, string> = { 0: "var(--seat-1)", 1: "var(--seat-2)" };
const SEAT_CONTRAST: Record<0 | 1, string> = {
  0: "var(--seat-1-contrast)",
  1: "var(--seat-2-contrast)",
};
const SEAT_GLYPH: Record<0 | 1, string> = { 0: "✕", 1: "●" };
const SEAT_LABEL: Record<0 | 1, string> = { 0: "red cross", 1: "blue circle" };

// The glossy sheen every filled disc carries, built from the palette's
// `--gloss-*` tokens rather than a hardcoded white.
const GLOSS = "radial-gradient(circle at 34% 28%, var(--gloss-highlight), var(--gloss-fade) 56%)";

function Disc({
  seat,
  isLastMove,
  previewSeat,
}: {
  seat: Cell;
  isLastMove: boolean;
  previewSeat?: 0 | 1;
}) {
  if (seat === null) {
    if (previewSeat !== undefined) {
      return (
        <span
          className="flex aspect-square w-full min-w-5 items-center justify-center rounded-full opacity-45 ring-2 ring-[var(--gloss-highlight)] ring-inset"
          style={{ backgroundColor: SEAT_COLOR[previewSeat] }}
          aria-hidden="true"
        />
      );
    }
    return (
      <span
        className="flex aspect-square w-full min-w-5 items-center justify-center rounded-full bg-[var(--board-hole)] shadow-[var(--shadow-inset)]"
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className={`flex aspect-square w-full min-w-5 items-center justify-center rounded-full text-xs font-bold shadow-[var(--game-piece-shadow)] sm:text-sm ${
        isLastMove
          ? "animate-[party-disc-drop_var(--dur-slow)_var(--ease-bounce)_both] ring-3 ring-[var(--accent)]"
          : ""
      }`}
      style={{
        backgroundColor: SEAT_COLOR[seat],
        backgroundImage: GLOSS,
        color: SEAT_CONTRAST[seat],
      }}
      role="img"
      aria-label={`${SEAT_LABEL[seat]} disc${isLastMove ? " (last move)" : ""}`}
    >
      {SEAT_GLYPH[seat]}
    </span>
  );
}

// `players` (from the match snapshot) is in join order, which is the same
// order `init()` assigned seats 0/1 in — so `players[seat]` is a
// straightforward lookup, not a leak of any hidden info (Connect 4 has none
// to begin with).
function nameFor(players: GameUiProps["players"], seat: 0 | 1): string {
  return players[seat]?.nickname ?? `Player ${seat + 1}`;
}

function SeatBadge({
  seat,
  name,
  isYou,
  isTurn,
}: {
  seat: 0 | 1;
  name: string;
  isYou: boolean;
  isTurn: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-[var(--radius-pill)] border-2 px-3 py-1.5 transition-[transform,border-color] duration-[var(--dur-base)] ease-[var(--ease-spring)] ${
        isTurn ? "scale-105 border-[var(--border-accent)]" : "border-transparent"
      }`}
      style={{ background: isTurn ? "var(--accent-soft)" : "var(--surface-1)" }}
    >
      <span
        aria-hidden="true"
        className="flex size-6 flex-none items-center justify-center rounded-full text-[0.6rem] font-bold shadow-[var(--shadow-1)]"
        style={{
          backgroundColor: SEAT_COLOR[seat],
          backgroundImage: GLOSS,
          color: SEAT_CONTRAST[seat],
        }}
      >
        {SEAT_GLYPH[seat]}
      </span>
      <span
        className={`truncate text-sm ${isYou ? "font-bold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}
      >
        {name}
        {isYou && " (you)"}
      </span>
    </div>
  );
}

export default function Connect4Ui({ view, players, result, send }: GameUiProps) {
  const v = view as Connect4View | null;
  const [activeCol, setActiveCol] = useState<number | null>(null);

  if (!v) {
    return <p className="m-0 text-[var(--text-muted)]">Loading board…</p>;
  }

  const disabled = v.winner !== null || v.draw || !v.yourTurn;
  const columnFull = (col: number) => v.board[ROWS - 1][col] !== null;
  const yourSeat = v.you === 0 || v.you === 1 ? v.you : null;
  // Which seat is on the clock, used only to highlight a badge. It cannot be
  // inferred from `turnNo`: the opening seat is drawn from the seeded PRNG
  // rather than always being seat 0, and `view()` deliberately exposes only
  // `you`/`yourTurn`, never the raw `turn`. For a seated player those two
  // flags pin it down exactly; a spectator gets no highlight rather than a
  // guessed one.
  const turnSeat: 0 | 1 | null =
    yourSeat === null ? null : v.yourTurn ? yourSeat : ((1 - yourSeat) as 0 | 1);

  const landingRowFor = (col: number): number | null => {
    for (let row = 0; row < ROWS; row++) {
      if (v.board[row][col] === null) return row;
    }
    return null;
  };

  function dropInColumn(col: number) {
    if (disabled || columnFull(col)) return;
    send({ t: "drop", col });
  }

  function clearActive(col: number) {
    setActiveCol((c) => (c === col ? null : c));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="mx-auto flex w-full max-w-lg flex-wrap items-center justify-center gap-2 sm:justify-between">
        {([0, 1] as const).map((seat) => (
          <SeatBadge
            key={seat}
            seat={seat}
            name={nameFor(players, seat)}
            isYou={v.you === seat}
            isTurn={!result && v.winner === null && !v.draw && turnSeat === seat}
          />
        ))}
      </div>

      <div
        className="mx-auto grid w-full max-w-lg gap-1 rounded-[var(--radius-lg)] border-4 p-1.5 shadow-[var(--shadow-inset),var(--shadow-2)] sm:gap-2 sm:p-3"
        aria-label="Connect 4 board, 7 columns by 6 rows"
        style={{
          gridTemplateColumns: `repeat(${COLS}, 1fr)`,
          background: "var(--board-well)",
          borderColor: "var(--board-rim)",
        }}
      >
        {Array.from({ length: COLS }, (_, col) => {
          const full = columnFull(col);
          const colDisabled = disabled || full;
          const canPreview = !colDisabled && yourSeat !== null;
          const landingRow = canPreview ? landingRowFor(col) : null;
          return (
            <button
              key={col}
              type="button"
              className={`flex cursor-pointer flex-col gap-1 rounded-[var(--radius-sm)] border-none p-1 transition-[background-color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed sm:gap-2 ${
                canPreview && activeCol === col
                  ? "-translate-y-0.5 bg-[var(--accent-soft)]"
                  : "bg-transparent"
              }`}
              disabled={colDisabled}
              aria-label={
                full
                  ? `Column ${col + 1}, full`
                  : `Drop a disc in column ${col + 1}${v.yourTurn ? "" : ", not your turn"}`
              }
              onClick={() => dropInColumn(col)}
              onMouseEnter={() => canPreview && setActiveCol(col)}
              onMouseLeave={() => clearActive(col)}
              onFocus={() => canPreview && setActiveCol(col)}
              onBlur={() => clearActive(col)}
            >
              {/* Render top-to-bottom (row ROWS-1 down to 0) since row 0 is the bottom of the board. */}
              {Array.from({ length: ROWS }, (_, i) => ROWS - 1 - i).map((row) => {
                const isPreview = canPreview && activeCol === col && landingRow === row;
                return (
                  <Disc
                    key={row}
                    seat={v.board[row][col]}
                    isLastMove={v.lastMove?.col === col && v.lastMove?.row === row}
                    previewSeat={isPreview ? (yourSeat ?? undefined) : undefined}
                  />
                );
              })}
            </button>
          );
        })}
      </div>

      {!result && (
        <p className="m-0 text-center text-sm font-semibold text-[var(--text-secondary)]">
          {v.winner !== null
            ? "Match finished."
            : v.yourTurn
              ? "Your turn — pick a column."
              : "Waiting for the other player…"}
        </p>
      )}
    </div>
  );
}
