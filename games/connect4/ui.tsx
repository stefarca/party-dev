import type { GameUiProps } from "../../shared/protocol";
import { COLS, ROWS } from "./game";

// Connect 4 board. No game-specific countdown here — the turn
// deadline is already shown once, generically, by `TurnIndicator` in
// `MatchPage`; duplicating it here would just be two clocks disagreeing by
// a second.

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
const SEAT_COLOR: Record<0 | 1, string> = { 0: "#c0392b", 1: "#2563eb" };
const SEAT_GLYPH: Record<0 | 1, string> = { 0: "X", 1: "O" };
const SEAT_LABEL: Record<0 | 1, string> = { 0: "red X", 1: "blue O" };

function Disc({ seat, isLastMove }: { seat: Cell; isLastMove: boolean }) {
  if (seat === null) {
    return <span className="c4-disc c4-disc-empty" aria-hidden="true" />;
  }
  return (
    <span
      className={`c4-disc c4-disc-filled${isLastMove ? " c4-disc-last" : ""}`}
      style={{ backgroundColor: SEAT_COLOR[seat] }}
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

  if (!v) {
    return <div className="card">Loading board…</div>;
  }

  const disabled = v.winner !== null || v.draw || !v.yourTurn;
  const columnFull = (col: number) => v.board[ROWS - 1][col] !== null;

  function dropInColumn(col: number) {
    if (disabled || columnFull(col)) return;
    send({ t: "drop", col });
  }

  return (
    <div className="card c4-board-card">
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
          return (
            <button
              key={col}
              type="button"
              className="c4-column"
              disabled={colDisabled}
              aria-label={
                full
                  ? `Column ${col + 1}, full`
                  : `Drop a disc in column ${col + 1}${v.yourTurn ? "" : ", not your turn"}`
              }
              onClick={() => dropInColumn(col)}
            >
              {/* Render top-to-bottom (row ROWS-1 down to 0) since row 0 is the bottom of the board. */}
              {Array.from({ length: ROWS }, (_, i) => ROWS - 1 - i).map((row) => (
                <Disc
                  key={row}
                  seat={v.board[row][col]}
                  isLastMove={v.lastMove?.col === col && v.lastMove?.row === row}
                />
              ))}
            </button>
          );
        })}
      </div>

      {!result && (
        <p className="c4-status">
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
