import { CUP_R } from "../game";
import type { Point } from "../game";
import { Burst, CONFETTI, SPRAY } from "./Burst";

const RIPPLE =
  "origin-center animate-[party-golf-ripple_var(--dur-slow)_var(--ease-out)_both] [transform-box:fill-box]";

// Where the last shot dropped or splashed: a ring spreading out from it, and
// confetti out of the cup or droplets out of the water.
export function Landing({ at, holed }: { at: Point; holed: boolean }) {
  return (
    <g>
      <circle
        cx={at[0]}
        cy={at[1]}
        r={CUP_R}
        fill="none"
        stroke={holed ? "var(--golf-flag)" : "var(--golf-wave)"}
        strokeWidth="0.8"
        className={RIPPLE}
      />
      {holed ? (
        <Burst at={at} colors={CONFETTI} reach={14} confetti />
      ) : (
        <Burst at={at} colors={SPRAY} reach={7} confetti={false} />
      )}
    </g>
  );
}
