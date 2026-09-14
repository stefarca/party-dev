import { useState } from "react";

import type { GameUiProps } from "../../shared/protocol";
import { COLS, ROWS } from "./game";

// Connect 4 board. No game-specific countdown here — the turn
// deadline is already shown once, generically, by `TurnIndicator` in
// `MatchPage`; duplicating it here would just be two clocks disagreeing by
// a second.
//
// The shell (`GameSurface`) provides the surrounding cabinet — this
// component renders only the board content that goes inside it.

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
const SEAT_GLYPH: Record<0 | 1, string> = { 0: "X", 1: "O" };
const SEAT_LABEL: Record<0 | 1, string> = { 0: "red X", 1: "blue O" };

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
          className="c4-disc c4-disc-preview"
          style={{ backgroundColor: SEAT_COLOR[previewSeat] }}
          aria-hidden="true"
        />
      );
    }
    return <span className="c4-disc c4-disc-empty" aria-hidden="true" />;
  }
  return (
    <span
      className={`c4-disc c4-disc-filled${isLastMove ? " c4-disc-last" : ""}`}
      style={{ backgroundColor: SEAT_COLOR[seat], color: SEAT_CONTRAST[seat] }}
      role="img"
      aria-label={`${SEAT_LABEL[seat]} disc${isLastMove ? " (last move)" : ""}`}
    >
      {SEAT_GLYPH[seat]}
    </span>
  );
}

// `players` (from the match snapshot) is in join order, which is the same
// order `init()` assigned seats 0/1 in — so `players[seat]` is a
// straightforward lookup, not a leak of any hidden info (Connect 4 has
// none to begin with).
function nameFor(players: GameUiProps["players"], seat: 0 | 1): string {
  return players[seat]?.nickname ?? `Player ${seat + 1}`;
}

export default function Connect4Ui({ view, players, result, send }: GameUiProps) {
  const v = view as Connect4View | null;
  const [activeCol, setActiveCol] = useState<number | null>(null);

  if (!v) {
    return <p className="game-muted">Loading board…</p>;
  }

  const disabled = v.winner !== null || v.draw || !v.yourTurn;
  const columnFull = (col: number) => v.board[ROWS - 1][col] !== null;
  const yourSeat = v.you === 0 || v.you === 1 ? v.you : null;

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
    <div className="c4-board-wrap">
      <div className="c4-seats">
        {([0, 1] as const).map((seat) => (
          <div key={seat} className={`c4-seat${v.you === seat ? " c4-seat-you" : ""}`}>
            <Disc seat={seat} isLastMove={false} />
            <span>
              {nameFor(players, seat)}
              {v.you === seat && " (you)"}
            </span>
          </div>
        ))}
      </div>

      <div
        className="c4-board"
        aria-label="Connect 4 board, 7 columns by 6 rows"
        style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}
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
              className={`c4-column${canPreview && activeCol === col ? " c4-column-live" : ""}`}
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
        <p className="c4-status game-text">
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
