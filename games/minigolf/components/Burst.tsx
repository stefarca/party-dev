import type { CSSProperties } from "react";

import type { Point } from "../game";

// What flies out of the cup, and out of a splash.
export const CONFETTI = ["var(--tile-8)", "var(--golf-flag)", "var(--tile-1024)", "var(--tile-32)"];
export const SPRAY = ["var(--golf-wave)", "var(--golf-foam)"];

// Pieces flying out from `at` and fading: confetti from the cup, or
// droplets from a splash. The animation moves each piece's group, so a
// strip of confetti keeps its own tilt as it flies.
export function Burst({
  at,
  colors,
  reach,
  confetti,
}: {
  at: Point;
  colors: string[];
  reach: number;
  confetti: boolean;
}) {
  const count = confetti ? 16 : 10;
  return (
    <g>
      {Array.from({ length: count }, (_, k) => {
        const turn = (k / count) * 2 * Math.PI + 0.3;
        const far = reach * (k % 2 === 0 ? 1 : 0.65);
        return (
          <g
            key={k}
            style={
              {
                "--golf-burst-x": `${Math.cos(turn) * far}px`,
                "--golf-burst-y": `${Math.sin(turn) * far}px`,
              } as CSSProperties
            }
            className="origin-center [transform-box:fill-box] animate-[party-golf-burst_900ms_var(--ease-out)_both]"
          >
            {confetti ? (
              <rect
                x={at[0] - 0.8}
                y={at[1] - 0.45}
                width="1.6"
                height="0.9"
                rx="0.2"
                fill={colors[k % colors.length]}
                transform={`rotate(${(k * 47) % 180} ${at[0]} ${at[1]})`}
              />
            ) : (
              <circle
                cx={at[0]}
                cy={at[1]}
                r={k % 3 === 0 ? 0.8 : 0.55}
                fill={colors[k % colors.length]}
              />
            )}
          </g>
        );
      })}
    </g>
  );
}
