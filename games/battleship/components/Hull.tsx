import type { CSSProperties } from "react";

import { LAND, box } from "../board";
import type { Placement } from "../game";

// Colour is never the only signal: a hit is a large ringed peg with a cross, a
// miss a small plain one, a sunk ship's name is on each of its squares, and a
// ship revealed at the end is an outline rather than a solid hull.
export type HullLook = "afloat" | "sunk" | "revealed" | "fits" | "blocked";

export interface HullSpec {
  key: string;
  placement: Placement;
  length: number;
  look: HullLook;
  landing?: boolean;
}

const GLOSS = "radial-gradient(circle at 30% 25%, var(--gloss-highlight), var(--gloss-fade) 60%)";

// How far a hull sits in from the edges of its squares, in squares.
const HULL_INSET = 0.12;

const HULL_STYLE: Record<HullLook, CSSProperties> = {
  afloat: { backgroundColor: "var(--board-hull)", backgroundImage: GLOSS },
  sunk: { backgroundColor: "var(--board-hull)", opacity: 0.55 },
  revealed: { border: "2px dashed var(--board-hull)" },
  fits: { border: "2px dashed var(--accent)", backgroundColor: "var(--accent-soft)" },
  blocked: { border: "2px dashed var(--seat-1)" },
};

export function Hull({ spec }: { spec: HullSpec }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute rounded-[var(--radius-pill)] ${
        spec.look === "afloat" ? "shadow-[var(--game-piece-shadow)]" : ""
      } ${spec.landing ? LAND : ""}`}
      style={{ ...box(spec.placement, spec.length, HULL_INSET), ...HULL_STYLE[spec.look] }}
    />
  );
}
