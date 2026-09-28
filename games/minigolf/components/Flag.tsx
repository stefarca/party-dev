import type { Point } from "../game";

// The flag in the cup, with the hole's number on it and its pole's shadow
// on the turf.
export function Flag({ cup, number }: { cup: Point; number: string }) {
  const [x, y] = cup;
  return (
    <g>
      <line
        x1={x}
        y1={y}
        x2={x + 5}
        y2={y + 2.4}
        stroke="var(--golf-shadow)"
        strokeWidth="0.8"
        strokeLinecap="round"
      />
      <line
        x1={x}
        y1={y}
        x2={x}
        y2={y - 13}
        stroke="var(--golf-pole)"
        strokeWidth="0.7"
        strokeLinecap="round"
      />
      <g className="origin-left [transform-box:fill-box] motion-safe:animate-[party-golf-flag_2.4s_ease-in-out_infinite]">
        <path
          d={`M${x} ${y - 13} H${x + 7.5} L${x + 6} ${y - 10.5} L${x + 7.5} ${y - 8} H${x} Z`}
          fill="var(--golf-flag)"
          stroke="var(--golf-ball-ring)"
          strokeWidth="0.35"
          strokeLinejoin="round"
        />
        <text
          x={x + 3.1}
          y={y - 10.4}
          fill="var(--tile-ink)"
          fontSize="3.6"
          fontWeight="700"
          textAnchor="middle"
          dominantBaseline="central"
          className="font-display"
        >
          {number}
        </text>
      </g>
      <circle cx={x} cy={y - 13.3} r="0.65" fill="var(--golf-flag)" />
    </g>
  );
}
