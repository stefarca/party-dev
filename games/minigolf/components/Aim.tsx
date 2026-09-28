import { BALL_R } from "../game";
import type { Point } from "../game";

// How long the aiming arrow is at no power and at full power.
const ARROW_MIN = 6;
const ARROW_MAX = 30;

// The next shot, drawn from the ball: a line of dots as long as the shot is
// hard, warming from white to hot as it gets harder, with a ring breathing
// out from the ball to say it is ready.
export function Aim({ ball, angle, power }: { ball: Point; angle: number; power: number }) {
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const length = ARROW_MIN + (ARROW_MAX - ARROW_MIN) * power;
  const tip: Point = [ball[0] + dx * length, ball[1] + dy * length];
  const dots: number[] = [];
  for (let d = BALL_R + 2; d < length - 2.5; d += 2.6) dots.push(d);
  const heat = `color-mix(in oklab, var(--golf-aim-hot) ${Math.round(power * 100)}%, var(--golf-ball))`;
  return (
    <g style={{ color: heat }}>
      <circle
        cx={ball[0]}
        cy={ball[1]}
        r={BALL_R + 0.6}
        fill="none"
        stroke="currentColor"
        strokeWidth="0.4"
        className="origin-center [transform-box:fill-box] motion-safe:animate-[party-golf-ready_1.6s_var(--ease-out)_infinite]"
      />
      {dots.map((d) => (
        <circle
          key={d}
          cx={ball[0] + dx * d}
          cy={ball[1] + dy * d}
          r={0.5 + (0.35 * d) / length}
          fill="currentColor"
          stroke="var(--golf-ball-ring)"
          strokeWidth="0.2"
        />
      ))}
      <path
        d={`M${tip[0]} ${tip[1]} L${tip[0] - dx * 2.8 - dy * 1.7} ${tip[1] - dy * 2.8 + dx * 1.7} L${
          tip[0] - dx * 2.8 + dy * 1.7
        } ${tip[1] - dy * 2.8 - dx * 1.7} Z`}
        fill="currentColor"
        stroke="var(--golf-ball-ring)"
        strokeWidth="0.3"
        strokeLinejoin="round"
      />
    </g>
  );
}
