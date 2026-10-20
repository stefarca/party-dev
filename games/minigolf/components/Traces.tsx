import { BALL_R } from "../game";

// Where the hole's earlier shots went, drawn faintly on the turf so the next
// one can be judged against them: the newest the clearest, each older one
// fainter.
export function Traces({ shots }: { shots: readonly number[][][] }) {
  return (
    <g
      fill="none"
      stroke="var(--golf-glint)"
      strokeWidth={BALL_R * 0.45}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray="0.1 1.6"
      pointerEvents="none"
    >
      {shots.map((lines, i) => (
        <g key={i} strokeOpacity={0.55 * 0.7 ** (shots.length - 1 - i)}>
          {lines.map((line, k) => (
            <polyline key={k} points={line.join(" ")} />
          ))}
        </g>
      ))}
    </g>
  );
}
