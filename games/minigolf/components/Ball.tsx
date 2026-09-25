import { BALL_R } from "../game";
import type { Point } from "../game";

// The ball at rest, lit by the `shine` gradient, over its shadow.

export function Ball({ at, shine }: { at: Point; shine: string }) {
  return (
    <g>
      <ellipse
        cx={at[0] + 0.5}
        cy={at[1] + 0.8}
        rx={BALL_R * 1.05}
        ry={BALL_R * 0.75}
        fill="var(--golf-shadow)"
      />
      <circle
        cx={at[0]}
        cy={at[1]}
        r={BALL_R}
        fill={`url(#${shine})`}
        stroke="var(--golf-ball-ring)"
        strokeWidth={0.35}
      />
      <circle cx={at[0] - 0.5} cy={at[1] - 0.55} r={0.45} fill="var(--golf-glint)" />
    </g>
  );
}
