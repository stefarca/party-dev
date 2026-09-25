import type { Area } from "../game";
import { points } from "../geometry";

// An outline of `area` drawn only on its inside: stroked at twice `width`
// and clipped to itself. What gives a bunker its sunken rim and a pond its
// shoreline.
export function Rim({
  area,
  clip,
  width,
  stroke,
  opacity,
}: {
  area: Area;
  clip: string;
  width: number;
  stroke: string;
  opacity: number;
}) {
  return (
    <polygon
      points={points(area)}
      fill="none"
      stroke={stroke}
      strokeOpacity={opacity}
      strokeWidth={width * 2}
      strokeLinejoin="round"
      clipPath={`url(#${clip})`}
    />
  );
}
