import type { CSSProperties } from "react";

import type { Area, Point } from "../game";
import { boxOf } from "../geometry";

// A pattern that slides across `area` and stays inside it. The clip is on
// a group of its own, outside the one that moves, so it stays put.
export function Drift({
  area,
  clip,
  fill,
  by,
  className,
}: {
  area: Area;
  clip: string;
  fill: string;
  by: Point;
  className: string;
}) {
  return (
    <g clipPath={`url(#${clip})`}>
      <g
        className={className}
        style={{ "--golf-drift-x": `${by[0]}px`, "--golf-drift-y": `${by[1]}px` } as CSSProperties}
      >
        <rect {...boxOf(area, Math.max(Math.abs(by[0]), Math.abs(by[1])))} fill={fill} />
      </g>
    </g>
  );
}
