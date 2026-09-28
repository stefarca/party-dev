import { CUP_R } from "../game";
import type { Hole } from "../game";
import { SLOPE_TILE, WAVE_ROWS, WAVE_TILE, fallRotation, points, wavesFrom } from "../geometry";
import { Drift } from "./Drift";
import { Rim } from "./Rim";

// The hole itself, drawn to scale: the turf inside its edge, and the water,
// sand, slopes and blocks laid on it. Every fill it defines is named from
// `ids`, which keeps two courses on one page apart.

export function Course({ hole, ids }: { hole: Hole; ids: string }) {
  const edge = points(hole.edge);
  return (
    <>
      <defs>
        <clipPath id={`${ids}-edge`}>
          <polygon points={edge} />
        </clipPath>
        {(
          [
            ["sand", hole.sand],
            ["water", hole.water],
            ["block", hole.blocks],
            ["slope", hole.slopes.map(({ area }) => area)],
          ] as const
        ).flatMap(([kind, areas]) =>
          areas.map((area, i) => (
            <clipPath key={`${kind}-${i}`} id={`${ids}-${kind}-${i}-clip`}>
              <polygon points={points(area)} />
            </clipPath>
          )),
        )}
        {/* Cross-mown turf: wide bands one way, and a fainter set the other, which is what
            gives it its chequer. */}
        <pattern id={`${ids}-mow`} width="20" height="20" patternUnits="userSpaceOnUse">
          <rect width="20" height="20" fill="var(--golf-green)" />
          <rect width="20" height="10" fill="var(--golf-stripe)" />
          <rect width="10" height="20" fill="var(--golf-glint)" fillOpacity="0.035" />
        </pattern>
        <pattern id={`${ids}-grain`} width="7" height="5" patternUnits="userSpaceOnUse">
          <circle cx="1.2" cy="1.1" r="0.28" fill="var(--golf-tee)" fillOpacity="0.45" />
          <circle cx="4.6" cy="2.9" r="0.24" fill="var(--golf-glint)" fillOpacity="0.14" />
          <circle cx="2.8" cy="4.2" r="0.2" fill="var(--golf-tee)" fillOpacity="0.35" />
          <circle cx="6.1" cy="0.6" r="0.2" fill="var(--golf-glint)" fillOpacity="0.1" />
        </pattern>
        {/* Light falling on the middle of the course, and dimming towards its rails. */}
        <radialGradient id={`${ids}-light`} cx="0.45" cy="0.4" r="0.75">
          <stop offset="0" stopColor="var(--golf-glint)" stopOpacity="0.1" />
          <stop offset="0.6" stopColor="var(--golf-glint)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--golf-wall)" stopOpacity="0.28" />
        </radialGradient>
        <pattern id={`${ids}-sand`} width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="4" fill="var(--golf-sand)" />
          <circle cx="0.8" cy="0.8" r="0.35" fill="var(--golf-sand-grain)" />
          <circle cx="2.9" cy="1.6" r="0.25" fill="var(--golf-sand-grain)" />
          <circle cx="1.9" cy="3.2" r="0.3" fill="var(--golf-sand-grain)" />
          <circle cx="3.5" cy="3.6" r="0.2" fill="var(--golf-glint)" fillOpacity="0.6" />
        </pattern>
        {/* Water as the legend shows it: one colour, with ripples. The course paints its depth
            and its ripples apart, so the ripples can drift. */}
        <pattern id={`${ids}-water`} width="8" height="4" patternUnits="userSpaceOnUse">
          <rect width="8" height="4" fill="var(--golf-water)" />
          <path
            d="M0 2 Q2 0.8 4 2 T8 2"
            fill="none"
            stroke="var(--golf-wave)"
            strokeWidth="0.45"
            strokeLinecap="round"
          />
        </pattern>
        {hole.water.map((area, i) => (
          <pattern
            key={i}
            id={`${ids}-waves-${i}`}
            y={wavesFrom(area)}
            width={WAVE_TILE}
            height={WAVE_ROWS * 2}
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M0.5 1 Q2 0 3.5 1 T6.5 1 M5.5 4 Q7 3 8.5 4"
              fill="none"
              stroke="var(--golf-wave)"
              strokeWidth="0.5"
              strokeLinecap="round"
            />
          </pattern>
        ))}
        <radialGradient id={`${ids}-deep`} r="0.7">
          <stop offset="0" stopColor="var(--golf-water-deep)" />
          <stop offset="1" stopColor="var(--golf-water)" />
        </radialGradient>
        <linearGradient id={`${ids}-bumper`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--golf-rail)" />
          <stop offset="1" stopColor="var(--golf-rail-side)" />
        </linearGradient>
        {hole.slopes.map((slope, i) => (
          <g key={i}>
            <pattern
              id={`${ids}-slope-${i}`}
              width={SLOPE_TILE}
              height={SLOPE_TILE}
              patternUnits="userSpaceOnUse"
              patternTransform={`rotate(${fallRotation(slope.fall)})`}
            >
              <path
                d="M2 3 L4 5 L6 3"
                fill="none"
                stroke="var(--golf-slope)"
                strokeWidth="0.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </pattern>
            {/* Lit at the top of the bank and shaded at its foot. */}
            <linearGradient
              id={`${ids}-slope-${i}-fall`}
              x1={0.5 - slope.fall[0] / 2}
              y1={0.5 - slope.fall[1] / 2}
              x2={0.5 + slope.fall[0] / 2}
              y2={0.5 + slope.fall[1] / 2}
            >
              <stop offset="0" stopColor="var(--golf-glint)" stopOpacity="0.16" />
              <stop offset="1" stopColor="var(--golf-wall)" stopOpacity="0.3" />
            </linearGradient>
          </g>
        ))}
      </defs>

      {/* The course's shadow on the table, then its rail: an outline, the rail's outer face and
          its top. Each is stroked on the outline and filled over by the turf, so only its
          outside half shows and the ball rolls right up to the line it bounces off. */}
      <polygon
        points={edge}
        transform="translate(0.8 1.6)"
        fill="var(--golf-shadow)"
        stroke="var(--golf-shadow)"
        strokeWidth="7"
        strokeLinejoin="round"
      />
      <polygon
        points={edge}
        fill="var(--golf-wall)"
        stroke="var(--golf-wall)"
        strokeWidth="7"
        strokeLinejoin="round"
      />
      <polygon
        points={edge}
        fill="none"
        stroke="var(--golf-rail-side)"
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <polygon
        points={edge}
        fill="none"
        stroke="var(--golf-rail)"
        strokeWidth="4.4"
        strokeLinejoin="round"
      />
      <polygon
        points={edge}
        fill="none"
        stroke="var(--golf-wall)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <polygon points={edge} fill={`url(#${ids}-mow)`} />
      <polygon points={edge} fill={`url(#${ids}-grain)`} />

      {hole.slopes.map((slope, i) => (
        <g key={i}>
          <polygon points={points(slope.area)} fill={`url(#${ids}-slope-${i}-fall)`} />
          <Drift
            area={slope.area}
            clip={`${ids}-slope-${i}-clip`}
            fill={`url(#${ids}-slope-${i})`}
            by={[slope.fall[0] * SLOPE_TILE, slope.fall[1] * SLOPE_TILE]}
            className="motion-safe:animate-[party-golf-drift_2.4s_linear_infinite]"
          />
        </g>
      ))}
      {hole.sand.map((area, i) => (
        <g key={i}>
          <polygon points={points(area)} fill={`url(#${ids}-sand)`} />
          <Rim
            area={area}
            clip={`${ids}-sand-${i}-clip`}
            width={1.6}
            stroke="var(--golf-sand-shade)"
            opacity={0.2}
          />
          <Rim
            area={area}
            clip={`${ids}-sand-${i}-clip`}
            width={0.7}
            stroke="var(--golf-sand-shade)"
            opacity={0.35}
          />
        </g>
      ))}
      {hole.water.map((area, i) => (
        <g key={i}>
          <polygon points={points(area)} fill={`url(#${ids}-deep)`} />
          <Drift
            area={area}
            clip={`${ids}-water-${i}-clip`}
            fill={`url(#${ids}-waves-${i})`}
            by={[WAVE_TILE, 0]}
            className="motion-safe:animate-[party-golf-drift_5s_linear_infinite]"
          />
          <Rim
            area={area}
            clip={`${ids}-water-${i}-clip`}
            width={0.8}
            stroke="var(--golf-foam)"
            opacity={0.55}
          />
        </g>
      ))}

      {/* Light on the turf, and the shade the rails and bumpers cast on it. */}
      <g clipPath={`url(#${ids}-edge)`}>
        <polygon points={edge} fill={`url(#${ids}-light)`} />
        {/* Several faint bands, each narrower than the last, which fade the shade out
            without a filter to blur it. */}
        {[7, 5.4, 3.8, 2.4, 1.2].map((width) => (
          <polygon
            key={width}
            points={edge}
            fill="none"
            stroke="var(--golf-shadow)"
            strokeOpacity="0.2"
            strokeWidth={width}
            strokeLinejoin="round"
          />
        ))}
        {hole.blocks.map((area, i) => (
          <polygon
            key={i}
            points={points(area)}
            transform="translate(0.9 1.5)"
            fill="var(--golf-shadow)"
          />
        ))}
      </g>

      {/* Bumpers: raised blocks of the rail's own stuff, lit from the top left. */}
      {hole.blocks.map((area, i) => (
        <g key={i}>
          <polygon points={points(area)} fill={`url(#${ids}-bumper)`} />
          <Rim
            area={area}
            clip={`${ids}-block-${i}-clip`}
            width={0.9}
            stroke="var(--golf-rail-side)"
            opacity={0.9}
          />
          <polygon
            points={points(area)}
            fill="none"
            stroke="var(--golf-wall)"
            strokeWidth="0.6"
            strokeLinejoin="round"
          />
        </g>
      ))}

      {/* The tee: a mat with a marker at each end. */}
      <rect
        x={hole.tee[0] - 5}
        y={hole.tee[1] - 3}
        width="10"
        height="6"
        rx="1.6"
        fill="var(--golf-tee)"
        stroke="var(--golf-tee-line)"
        strokeWidth="0.4"
      />
      {[-3.6, 3.6].map((dx) => (
        <circle
          key={dx}
          cx={hole.tee[0] + dx}
          cy={hole.tee[1]}
          r="0.75"
          fill="var(--golf-flag)"
          stroke="var(--golf-wall)"
          strokeWidth="0.25"
        />
      ))}

      {/* The cup: a lip catching the light, the hole, and the liner inside it. */}
      <circle
        cx={hole.cup[0]}
        cy={hole.cup[1]}
        r={CUP_R + 0.35}
        fill="none"
        stroke="var(--golf-glint)"
        strokeOpacity="0.4"
        strokeWidth="0.5"
      />
      <circle cx={hole.cup[0]} cy={hole.cup[1]} r={CUP_R} fill="var(--board-hole)" />
      <circle
        cx={hole.cup[0]}
        cy={hole.cup[1] + 0.4}
        r={CUP_R - 0.5}
        fill="var(--golf-cup-liner)"
      />
      <circle cx={hole.cup[0]} cy={hole.cup[1] - 0.15} r={CUP_R - 0.6} fill="var(--board-hole)" />
    </>
  );
}
