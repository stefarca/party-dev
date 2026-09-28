import { useTranslation } from "react-i18next";

import { SIZE, SQUARES, isDarkSquare } from "../game";
import type { Side } from "../game";
import type { MoveInProgress } from "../useMove";
import type { CheckersView } from "../view";
import { Square } from "./Square";

function other(side: Side): Side {
  return side === "red" ? "blue" : "red";
}

// The board, drawn from this player's side: blue sees it turned half a
// circle, so their men also advance up the screen.
export function Board({ view: v, move }: { view: CheckersView; move: MoveInProgress }) {
  const { t } = useTranslation("checkers");
  const { movable, selection, targets, moving, jumping, choose } = move;
  const yourSide = v.you === "spectator" ? null : v.you;
  const flip = v.you === "blue";

  const lastPath = new Set(v.lastMove?.path ?? []);
  const lastCaptured = new Set(v.lastMove?.captured ?? []);
  const landedOn = v.lastMove ? v.lastMove.path[v.lastMove.path.length - 1] : null;
  const capturedSide = v.lastMove ? other(v.lastMove.side) : null;

  // Rows and columns are counted as displayed, top-left first, so a label
  // matches what a sighted teammate sees on the same screen.
  const squareLabel = (square: number, shown: number): string => {
    const piece = v.board[square];
    const pieceName = piece ? t(`piece.${piece.side}.${piece.king ? "king" : "man"}`) : null;
    const notes = [
      t("square.position", { row: Math.floor(shown / SIZE) + 1, column: (shown % SIZE) + 1 }),
      pieceName === null
        ? t("square.empty")
        : piece?.side === yourSide
          ? t("piece.yours", { piece: pieceName })
          : pieceName,
      square === selection[0] ? t("square.pickedUp") : null,
      targets.has(square) ? t(v.mustJump ? "square.jumpHere" : "square.moveHere") : null,
      movable.has(square) && square !== selection[0] ? t("square.canMove") : null,
      jumping.has(square) ? t("square.beingJumped") : null,
      lastPath.has(square) ? t("square.lastMove") : null,
      lastCaptured.has(square) && piece === null ? t("square.capturedLastMove") : null,
    ];
    return notes.filter(Boolean).join(", ");
  };

  return (
    <div
      role="group"
      aria-label={t(flip ? "board.blue" : "board.red", { size: SIZE })}
      className="mx-auto w-full max-w-lg rounded-[var(--radius-lg)] border-4 p-1.5 shadow-[var(--shadow-inset),var(--shadow-2)] sm:p-2"
      style={{ background: "var(--board-well)", borderColor: "var(--board-rim)" }}
    >
      <div
        className="grid overflow-hidden rounded-[var(--radius-sm)]"
        style={{ gridTemplateColumns: `repeat(${SIZE}, 1fr)` }}
      >
        {Array.from({ length: SQUARES }, (_, shown) => {
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

          const picked = square === selection[0];
          const target = targets.has(square);
          const inProgress = selection.indexOf(square) > 0;
          return (
            <Square
              key={square}
              piece={v.board[square]}
              label={squareLabel(square, shown)}
              playable={v.yourTurn && (target || picked || movable.has(square))}
              picked={picked}
              target={target}
              inProgress={inProgress}
              canMove={movable.has(square) && v.yourTurn}
              beingJumped={jumping.has(square)}
              onLastPath={lastPath.has(square)}
              landedOn={square === landedOn}
              captured={lastCaptured.has(square) ? capturedSide : null}
              capturedKey={v.turnNo}
              jumper={inProgress && square === selection[selection.length - 1] ? moving : null}
              onChoose={() => choose(square)}
            />
          );
        })}
      </div>
    </div>
  );
}
