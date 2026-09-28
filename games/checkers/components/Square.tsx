import type { Piece, Side } from "../game";
import { PieceDisc } from "./PieceDisc";

const LAND = "animate-[party-piece-land_var(--dur-slow)_var(--ease-spring)_both]";
const VANISH = "animate-[party-piece-vanish_var(--dur-slow)_var(--ease-out)_both]";

// One dark square, and the button that plays it. Everything it marks comes
// in as a flag: the piece picked up, the squares it may go to, the path of
// a jump in progress, and the last move with whatever it captured.
export function Square({
  piece,
  label,
  playable,
  picked,
  target,
  inProgress,
  canMove,
  beingJumped,
  onLastPath,
  landedOn,
  captured,
  capturedKey,
  jumper,
  onChoose,
}: {
  piece: Piece | null;
  label: string;
  playable: boolean;
  picked: boolean;
  target: boolean;
  // On the path of the jump in progress, past its start.
  inProgress: boolean;
  // Holds a piece this player may move, on their turn.
  canMove: boolean;
  beingJumped: boolean;
  onLastPath: boolean;
  landedOn: boolean;
  // The side of a piece the last move took from this square, if any.
  captured: Side | null;
  // Changes with every move, so a capture's ghost fades out afresh.
  capturedKey: number;
  // The jumping piece, drawn here while the jump in progress has got this far.
  jumper: Piece | null;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!playable}
      onClick={onChoose}
      aria-label={label}
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
        onLastPath && (
          <span aria-hidden="true" className="absolute inset-0 bg-[var(--board-mark)]" />
        )
      )}

      {piece !== null ? (
        <PieceDisc
          piece={piece}
          className={[
            "relative w-4/5 transition-[translate,opacity,scale] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
            landedOn ? LAND : "",
            picked ? "-translate-y-1 scale-110 ring-3 ring-[var(--accent)]" : "",
            !picked && canMove
              ? "ring-2 ring-[var(--border-accent)] group-hover:-translate-y-0.5"
              : "",
            beingJumped ? "scale-75 opacity-40" : "",
          ].join(" ")}
        />
      ) : (
        captured && (
          // A faint ghost of what was taken, so a player coming back to the
          // match can see what happened while they were away.
          <PieceDisc
            key={capturedKey}
            piece={{ side: captured, king: false }}
            className={`absolute w-4/5 ${VANISH}`}
          />
        )
      )}

      {jumper && <PieceDisc piece={jumper} className="absolute w-4/5 opacity-50" />}

      {target && (
        <span
          aria-hidden="true"
          className="absolute size-1/4 rounded-full bg-[var(--accent)] shadow-[var(--glow-accent)] transition-[scale] duration-[var(--dur-fast)] ease-[var(--ease-spring)] group-hover:scale-150 group-focus-visible:scale-150"
        />
      )}
    </button>
  );
}
