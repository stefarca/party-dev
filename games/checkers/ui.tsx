import { useState } from "react";
import type { CSSProperties } from "react";

import type { GameUiProps } from "../../shared/protocol";
import { QUIET_PLY_LIMIT, SIZE, SQUARES, isDarkSquare } from "./game";
import type { Piece, Side, Square } from "./game";

// Checkers board. The turn deadline is shown once, generically, by
// `TurnIndicator` in `MatchPage` — no countdown here. The shell
// (`GameSurface`) provides the cabinet; this renders only the board, painted
// with the theme-independent `--board-*` tokens so the pieces stay vivid in
// both light and dark mode. Each player sees their own pieces at the bottom.

interface CheckersView {
  board: Square[]; // row-major: board[row * SIZE + col], row 0 = blue's back row
  players: Record<Side, string>;
  you: Side | "spectator";
  turn: Side | null;
  yourTurn: boolean;
  turnNo: number;
  lastMove: { side: Side; path: number[]; captured: number[] } | null;
  moves: number[][]; // your legal moves as square paths, sent only while it is your turn
  mustJump: boolean;
  quietPlies: number;
  winner: Side | null;
  draw: boolean;
}

// Colour is never the only signal: red pieces carry a solid inner ring and
// blue pieces a dashed one, kings add a crown, and every square's aria-label
// names the piece on it.
const SIDE_COLOR: Record<Side, string> = { red: "var(--seat-1)", blue: "var(--seat-2)" };
const SIDE_CONTRAST: Record<Side, string> = {
  red: "var(--seat-1-contrast)",
  blue: "var(--seat-2-contrast)",
};
const SIDE_RING_DASH: Record<Side, string | undefined> = { red: undefined, blue: "2.4 2.1" };

const GLOSS = "radial-gradient(circle at 34% 28%, var(--gloss-highlight), var(--gloss-fade) 56%)";
const CROWN = "M7 16 6.2 9.2 9.8 12 12 7.6 14.2 12 17.8 9.2 17 16z";

const LAND = "animate-[party-piece-land_var(--dur-slow)_var(--ease-spring)_both]";
const VANISH = "animate-[party-piece-vanish_var(--dur-slow)_var(--ease-out)_both]";

function other(side: Side): Side {
  return side === "red" ? "blue" : "red";
}

function startsWith(path: number[], prefix: number[]): boolean {
  return prefix.every((square, i) => path[i] === square);
}

function PieceDisc({
  piece,
  className = "",
  style,
}: {
  piece: Piece;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex aspect-square flex-none items-center justify-center rounded-full shadow-[var(--game-piece-shadow)] ${className}`}
      style={{
        backgroundColor: SIDE_COLOR[piece.side],
        backgroundImage: GLOSS,
        color: SIDE_CONTRAST[piece.side],
        ...style,
      }}
    >
      <svg viewBox="0 0 24 24" className="size-full">
        <circle
          cx="12"
          cy="12"
          r="8.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeDasharray={SIDE_RING_DASH[piece.side]}
          opacity={0.55}
        />
        {piece.king && <path d={CROWN} fill="currentColor" />}
      </svg>
    </span>
  );
}

function SeatBadge({
  side,
  name,
  left,
  isYou,
  isTurn,
}: {
  side: Side;
  name: string;
  left: number;
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
      <PieceDisc piece={{ side, king: false }} className="size-7" />
      <span
        className={`truncate text-sm ${isYou ? "font-bold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}
      >
        {name}
        {isYou && " (you)"}
      </span>
      <span className="text-xs text-[var(--text-muted)] tabular-nums">{left} left</span>
    </div>
  );
}

export default function CheckersUi({ view, players, result, send }: GameUiProps) {
  const v = view as CheckersView | null;
  // The squares picked so far this turn: the piece, then each landing square
  // of a jump in progress. Tagged with the turn it was picked on, so the next
  // snapshot clears it without an effect.
  const [picked, setPicked] = useState<{ turnNo: number; path: number[] }>({
    turnNo: -1,
    path: [],
  });

  if (!v) {
    return <p className="m-0 text-[var(--text-muted)]">Loading board…</p>;
  }

  const yourSide = v.you === "spectator" ? null : v.you;
  const nameFor = (side: Side): string =>
    players.find((p) => p.id === v.players[side])?.nickname ?? (side === "red" ? "Red" : "Blue");
  const piecesLeft = (side: Side): number =>
    v.board.filter((square) => square?.side === side).length;

  const movable = new Set(v.moves.map((path) => path[0]));
  const chosen = picked.turnNo === v.turnNo ? picked.path : [];
  // When only one piece can move (a forced jump, say), it starts picked up.
  const selection = chosen.length > 0 ? chosen : movable.size === 1 ? [...movable] : [];
  const targets = new Set(
    selection.length > 0
      ? v.moves.filter((path) => startsWith(path, selection)).map((path) => path[selection.length])
      : [],
  );
  const moving = selection.length > 0 ? v.board[selection[0]] : null;
  // Pieces the jump in progress has already passed over: a jump lands two
  // squares away diagonally, so the jumped square is the midpoint.
  const jumping = new Set<number>();
  for (let i = 1; i < selection.length; i++) {
    jumping.add((selection[i - 1] + selection[i]) / 2);
  }

  const lastPath = new Set(v.lastMove?.path ?? []);
  const lastCaptured = new Set(v.lastMove?.captured ?? []);
  const landedOn = v.lastMove ? v.lastMove.path[v.lastMove.path.length - 1] : null;
  const capturedSide = v.lastMove ? other(v.lastMove.side) : null;

  const choose = (square: number) => {
    if (targets.has(square)) {
      const path = [...selection, square];
      const remaining = v.moves.filter((m) => startsWith(m, path));
      if (remaining.length === 1) {
        // The rest of the move is forced, so finish it rather than asking
        // for every hop.
        send({ t: "move", path: remaining[0] });
        setPicked({ turnNo: v.turnNo, path: [] });
      } else {
        setPicked({ turnNo: v.turnNo, path });
      }
    } else if (square === selection[0]) {
      setPicked({ turnNo: v.turnNo, path: [] });
    } else if (movable.has(square)) {
      setPicked({ turnNo: v.turnNo, path: [square] });
    }
  };

  // Rows and columns are counted as displayed, top-left first, so a label
  // matches what a sighted teammate sees on the same screen.
  const squareLabel = (square: number, shown: number): string => {
    const piece = v.board[square];
    const notes = [
      `Row ${Math.floor(shown / SIZE) + 1}, column ${(shown % SIZE) + 1}`,
      piece
        ? `${piece.side} ${piece.king ? "king" : "man"}${piece.side === yourSide ? " (yours)" : ""}`
        : "empty",
      square === selection[0] ? "picked up" : null,
      targets.has(square) ? (v.mustJump ? "jump here" : "move here") : null,
      movable.has(square) && square !== selection[0] ? "can move" : null,
      jumping.has(square) ? "being jumped" : null,
      lastPath.has(square) ? "part of the last move" : null,
      lastCaptured.has(square) && piece === null ? "captured on the last move" : null,
    ];
    return notes.filter(Boolean).join(", ");
  };

  const flip = v.you === "blue";
  const status = v.yourTurn
    ? selection.length > 1
      ? "Keep jumping — pick the next landing square."
      : selection.length === 1
        ? v.mustJump
          ? "Pick where to jump."
          : "Pick where to move."
        : v.mustJump
          ? "Your turn — you must jump."
          : "Your turn — pick a piece to move."
    : v.turn
      ? `Waiting for ${nameFor(v.turn)}…`
      : "Match finished.";
  const quietLeft = QUIET_PLY_LIMIT - v.quietPlies;

  return (
    <div className="flex flex-col gap-4">
      <div className="mx-auto flex w-full max-w-lg flex-wrap items-center justify-center gap-2 sm:justify-between">
        {(["red", "blue"] as const).map((side) => (
          <SeatBadge
            key={side}
            side={side}
            name={nameFor(side)}
            left={piecesLeft(side)}
            isYou={v.you === side}
            isTurn={!result && v.turn === side}
          />
        ))}
      </div>

      <div
        role="group"
        aria-label={`Checkers board, 8 by 8, ${flip ? "blue" : "red"} at the bottom`}
        className="mx-auto w-full max-w-lg rounded-[var(--radius-lg)] border-4 p-1.5 shadow-[var(--shadow-inset),var(--shadow-2)] sm:p-2"
        style={{ background: "var(--board-well)", borderColor: "var(--board-rim)" }}
      >
        <div
          className="grid overflow-hidden rounded-[var(--radius-sm)]"
          style={{ gridTemplateColumns: `repeat(${SIZE}, 1fr)` }}
        >
          {Array.from({ length: SQUARES }, (_, shown) => {
            // Blue sees the board turned half a circle, so their men also
            // advance up the screen.
            const square = flip ? SQUARES - 1 - shown : shown;
            if (!isDarkSquare(square)) {
              return (
                <div
                  key={square}
                  aria-hidden="true"
                  className="aspect-square"
                  style={{ background: "var(--board-rim)" }}
                />
              );
            }

            const piece = v.board[square];
            const isPicked = square === selection[0];
            const isTarget = targets.has(square);
            const inProgress = selection.indexOf(square) > 0;
            const playable = v.yourTurn && (isTarget || isPicked || movable.has(square));
            return (
              <button
                key={square}
                type="button"
                disabled={!playable}
                onClick={() => choose(square)}
                aria-label={squareLabel(square, shown)}
                className={`group relative flex aspect-square items-center justify-center border-none bg-[var(--board-hole)] p-0 focus-visible:z-10 focus-visible:outline-offset-[-3px] disabled:cursor-default ${
                  playable ? "cursor-pointer" : ""
                }`}
              >
                {inProgress ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 bg-[var(--accent)]/30 ring-2 ring-[var(--accent)] ring-inset"
                  />
                ) : (
                  lastPath.has(square) && (
                    <span aria-hidden="true" className="absolute inset-0 bg-[var(--board-mark)]" />
                  )
                )}

                {piece !== null ? (
                  <PieceDisc
                    piece={piece}
                    className={[
                      "relative w-4/5 transition-[translate,opacity,scale] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                      square === landedOn ? LAND : "",
                      isPicked ? "-translate-y-1 scale-110 ring-3 ring-[var(--accent)]" : "",
                      !isPicked && movable.has(square) && v.yourTurn
                        ? "ring-2 ring-[var(--border-accent)] group-hover:-translate-y-0.5"
                        : "",
                      jumping.has(square) ? "scale-75 opacity-40" : "",
                    ].join(" ")}
                  />
                ) : (
                  lastCaptured.has(square) &&
                  capturedSide && (
                    // A faint ghost of what was taken, so a player coming back
                    // to the match can see what happened while they were away.
                    <PieceDisc
                      key={v.turnNo}
                      piece={{ side: capturedSide, king: false }}
                      className={`absolute w-4/5 ${VANISH}`}
                    />
                  )
                )}

                {moving && inProgress && square === selection[selection.length - 1] && (
                  // Where the jumping piece has got to so far.
                  <PieceDisc piece={moving} className="absolute w-4/5 opacity-50" />
                )}

                {isTarget && (
                  <span
                    aria-hidden="true"
                    className="absolute size-1/4 rounded-full bg-[var(--accent)] shadow-[var(--glow-accent)] transition-[scale] duration-[var(--dur-fast)] ease-[var(--ease-spring)] group-hover:scale-150 group-focus-visible:scale-150"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {!result && (
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="m-0 text-sm font-semibold text-[var(--text-secondary)]">{status}</p>
          {v.turn && quietLeft <= 20 && (
            <p className="m-0 text-xs text-[var(--text-muted)]">
              No capture or man moved in a while: the game is drawn in {quietLeft} more{" "}
              {quietLeft === 1 ? "turn" : "turns"} without one.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
