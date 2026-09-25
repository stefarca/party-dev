import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import type { DailyUiProps } from "../../shared/protocol";
import {
  BALL_R,
  CUP_R,
  FIELD_H,
  FIELD_W,
  HOLE_CAP,
  MAX_STROKES,
  MIN_POWER,
  SAMPLE_MS,
} from "./game";
import type { Area, Hole, LastShot, MinigolfView, Point } from "./game";
import type strings from "./locales/en.json";

declare module "i18next" {
  interface ResourceNamespaceMap {
    minigolf: typeof strings;
  }
}

// The mini golf course: one hole at a time, drawn to scale, with the aim and
// power of the next shot set by dragging back from the ball like a
// slingshot, or on the two sliders below it. A shot goes to the server,
// which alone rolls the ball, and comes back as the path the ball took; the
// page plays that path back, then shows where the ball came to rest. A hole
// the shot finished stays on screen, with what it scored, until its player
// moves on to the next one.
//
// The course is a picture, and its accessible name says what matters about
// it: the hole, its par, its hazards, and how far away the cup is and which
// way. The aim is a compass bearing, so a player who cannot see the course
// can still aim at the cup.
//
// Some of the picture moves on its own: ripples drift across a pond,
// chevrons slide down a slope, the flag stirs and the ball waiting to be hit
// breathes a ring. None of it is needed to play, so none of it runs for a
// player who prefers reduced motion.

// The browser's frame clock and motion preference, reached through narrow
// types of their own: the Worker's type-check of this file has no DOM.
interface FrameClock {
  requestAnimationFrame(callback: (time: number) => void): number;
  cancelAnimationFrame(handle: number): void;
  matchMedia?(query: string): { matches: boolean };
}

interface Focusable {
  focus(): void;
}

interface Box {
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  setPointerCapture?(pointer: number): void;
}

const clock = globalThis as unknown as FrameClock;

// A slider's value, read the same way.
const valueOf = (input: unknown) => (input as { value: string }).value;

function prefersReducedMotion(): boolean {
  return clock.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

// How far back, in course units, a drag goes for a full-power shot, and how
// short a drag is let go without shooting.
const DRAG_FULL = 40;
const DRAG_MIN = 3;

// How long the aiming arrow is at no power and at full power.
const ARROW_MIN = 6;
const ARROW_MAX = 30;

const BUTTON =
  "flex cursor-pointer items-center justify-center border text-[var(--text-primary)] shadow-[var(--edge-highlight)] transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] touch-manipulation not-disabled:hover:scale-105 not-disabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-40";
const PRIMARY = "border-transparent bg-[var(--accent)] text-[var(--text-on-accent)]";

const RIPPLE =
  "origin-center animate-[party-golf-ripple_var(--dur-slow)_var(--ease-out)_both] [transform-box:fill-box]";

// Compass bearing from `from` to `to`, in whole degrees clockwise from up.
function bearing(from: Point, to: Point): number {
  const degrees = (Math.atan2(to[0] - from[0], from[1] - to[1]) * 180) / Math.PI;
  return Math.round((degrees + 360) % 360) % 360;
}

function distance(from: Point, to: Point): number {
  return Math.hypot(to[0] - from[0], to[1] - from[1]);
}

const points = (area: Area) => area.map(([x, y]) => `${x},${y}`).join(" ");

// The rotation that turns a downward chevron to point along `fall`.
function fallRotation([x, y]: Point): number {
  return (Math.atan2(-x, y) * 180) / Math.PI;
}

// A golf term for a hole's score against its par.
function termOf(strokes: number, par: number) {
  const toPar = strokes - par;
  if (toPar <= -2) return "eagle" as const;
  if (toPar === -1) return "birdie" as const;
  if (toPar === 0) return "par" as const;
  if (toPar === 1) return "bogey" as const;
  if (toPar === 2) return "double" as const;
  return "triple" as const;
}

// The bounding box of `area`, grown by `pad` on every side.
function boxOf(area: Area, pad: number) {
  const xs = area.map(([x]) => x);
  const ys = area.map(([, y]) => y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, width: Math.max(...xs) + pad - x, height: Math.max(...ys) + pad - y };
}

// How far, in course units, one tile of the ripple and chevron patterns
// spans along the way it drifts, and how far apart the rows of ripples are.
const WAVE_TILE = 10;
const WAVE_ROWS = 3;
const SLOPE_TILE = 8;

// Where a pond's ripple pattern starts, so its rows sit evenly between its
// top and bottom, clear of its shore, rather than wherever the course's grid
// would cut them. The pattern draws its first row 0.75 below its start.
function wavesFrom(area: Area): number {
  const top = Math.min(...area.map(([, y]) => y));
  const height = Math.max(...area.map(([, y]) => y)) - top;
  const rows = Math.floor(height / WAVE_ROWS);
  return top + (height - WAVE_ROWS * (rows - 1)) / 2 - 0.75;
}

// A pattern that slides across `area` and stays inside it. The clip is on
// a group of its own, outside the one that moves, so it stays put.
function Drift({
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

// An outline of `area` drawn only on its inside: stroked at twice `width`
// and clipped to itself. What gives a bunker its sunken rim and a pond its
// shoreline.
function Rim({
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

// A hole's score marked the way a paper scorecard marks it: ringed under
// par and boxed over it, twice for two strokes or more either way.
const MARK: Record<ReturnType<typeof termOf>, string> = {
  eagle: "rounded-full border-4 border-double border-[var(--ok-fg)]",
  birdie: "rounded-full border-2 border-[var(--ok-fg)]",
  par: "",
  bogey: "rounded-[4px] border-2 border-[var(--warn-fg)]",
  double: "rounded-[4px] border-4 border-double border-[var(--warn-fg)]",
  triple: "rounded-[4px] border-4 border-double border-[var(--danger-fg)]",
};

function Ball({ at, shine }: { at: Point; shine: string }) {
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

// How many of the path's samples the rolling ball's trail reaches back.
const TRAIL = 10;

// The ball rolling along `path`, played back in real time, with a trail
// fading out behind it. Calls `onDone` once it has reached the end,
// straight away when motion is reduced.
function Flight({ path, shine, onDone }: { path: number[]; shine: string; onDone: () => void }) {
  const [along, setAlong] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const last = path.length / 2 - 1;
    if (last <= 0 || prefersReducedMotion()) {
      done.current();
      return;
    }
    let start: number | null = null;
    let handle = 0;
    const frame = (time: number) => {
      start ??= time;
      const next = Math.min((time - start) / SAMPLE_MS, last);
      setAlong(next);
      if (next >= last) done.current();
      else handle = clock.requestAnimationFrame(frame);
    };
    handle = clock.requestAnimationFrame(frame);
    return () => clock.cancelAnimationFrame(handle);
  }, [path]);

  const last = path.length / 2 - 1;
  const i = Math.min(Math.floor(along), last);
  const j = Math.min(i + 1, last);
  const f = along - i;
  const at: Point = [
    path[2 * i] + (path[2 * j] - path[2 * i]) * f,
    path[2 * i + 1] + (path[2 * j + 1] - path[2 * i + 1]) * f,
  ];
  const trail: Point[] = [];
  for (let k = Math.max(0, i - TRAIL); k <= i; k++) trail.push([path[2 * k], path[2 * k + 1]]);
  trail.push(at);

  return (
    <>
      {trail.slice(1).map((to, k) => {
        const from = trail[k];
        const share = (k + 1) / (trail.length - 1);
        return (
          <line
            key={k}
            x1={from[0]}
            y1={from[1]}
            x2={to[0]}
            y2={to[1]}
            stroke="var(--golf-ball)"
            strokeOpacity={0.45 * share}
            strokeWidth={BALL_R * 1.5 * share}
            strokeLinecap="round"
          />
        );
      })}
      <Ball at={at} shine={shine} />
    </>
  );
}

function Course({ hole, ids }: { hole: Hole; ids: string }) {
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

// The flag in the cup, with the hole's number on it and its pole's shadow
// on the turf.
function Flag({ cup, number }: { cup: Point; number: string }) {
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

// The next shot, drawn from the ball: a line of dots as long as the shot is
// hard, warming from white to hot as it gets harder, with a ring breathing
// out from the ball to say it is ready.
function Aim({ ball, angle, power }: { ball: Point; angle: number; power: number }) {
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

const CONFETTI = ["var(--tile-8)", "var(--golf-flag)", "var(--tile-1024)", "var(--tile-32)"];
const SPRAY = ["var(--golf-wave)", "var(--golf-foam)"];

// Pieces flying out from `at` and fading: confetti from the cup, or
// droplets from a splash. The animation moves each piece's group, so a
// strip of confetti keeps its own tilt as it flies.
function Burst({
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

export default function MinigolfUi({ view, status, send }: DailyUiProps) {
  const { t, i18n } = useTranslation("minigolf");
  const language = i18n.resolvedLanguage ?? "en";
  const v = view as MinigolfView | null;
  const ids = `golf${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  // Shots the page has already shown, counting from those it loaded with:
  // any shot past that is played back before the course moves on.
  const loadedWith = useRef<number | null>(null);
  if (v && loadedWith.current === null) loadedWith.current = v.shots;
  const [shown, setShown] = useState<number | null>(null);
  // A hole the last shot finished, kept on screen until its player moves on.
  const [finished, setFinished] = useState<LastShot | null>(null);
  // The view a shot was sent from. Until a new one arrives, the shot is on
  // its way, and there is no ball to hit.
  const [sentFrom, setSentFrom] = useState<unknown>(null);

  const [angle, setAngle] = useState(0);
  const [power, setPower] = useState(0.5);
  const [aimedAt, setAimedAt] = useState<string | null>(null);
  const drag = useRef<{ pointer: number; x: number; y: number } | null>(null);
  const [pull, setPull] = useState<{ from: Point; to: Point } | null>(null);
  // Held as `unknown` and narrowed where it is focused: the Worker's
  // type-check of this file has an element type with no `focus()`.
  const shootButton = useRef<unknown>(null);

  if (!v) {
    return <p className="m-0 text-[var(--text-muted)]">{t("loading")}</p>;
  }

  const seen = shown ?? loadedWith.current ?? v.shots;
  const flying = v.last !== null && v.shots > seen ? v.last : null;
  // The hole on screen is the one the last shot was played on while it
  // rolls, while it waits to be moved on from, and once the round is done.
  const holding = flying ?? finished ?? (v.over ? v.last : null);
  const holeIndex = holding ? holding.hole : v.hole;
  const hole = v.course[holeIndex];
  const strokes = holding ? holding.strokes : v.strokes;
  const lastEnd: Point | null = holding
    ? [holding.path[holding.path.length - 2], holding.path[holding.path.length - 1]]
    : null;
  // The ball as it lies: gone once it drops or is picked up.
  const ball: Point | null = holding ? (holding.outcome === "rest" ? lastEnd : null) : v.ball;
  // Where the course's name measures from: where the ball lies, or where a
  // splash sent it back to.
  const described: Point | null = holding
    ? holding.outcome === "holed"
      ? null
      : holding.outcome === "water"
        ? holding.from
        : lastEnd
    : v.ball;

  const playing = status === "active" && !v.over;
  const canShoot = playing && !flying && !finished && sentFrom !== view && ball !== null;

  // Every new ball position starts aimed at the cup.
  const aimKey = `${holeIndex}:${v.ball[0]}:${v.ball[1]}`;
  if (canShoot && aimedAt !== aimKey) {
    setAimedAt(aimKey);
    setAngle(bearing(v.ball, hole.cup));
  }

  const shoot = (shotAngle: number, shotPower: number) => {
    if (!canShoot) return;
    setSentFrom(view);
    send({ t: "shot", n: v.shots, angle: shotAngle, power: shotPower });
  };

  const landed = () => {
    setShown(v.shots);
    if (v.last && v.last.card !== null && !v.over) setFinished(v.last);
  };

  // A drag, from where it started to where the pointer is, as the shot it
  // would be: the ball goes the opposite way, as hard as it was pulled.
  const fieldPoint = (box: Box, clientX: number, clientY: number): Point => {
    const rect = box.getBoundingClientRect();
    return [
      ((clientX - rect.left) / rect.width) * FIELD_W,
      ((clientY - rect.top) / rect.height) * FIELD_H,
    ];
  };
  const pulled = (box: Box, clientX: number, clientY: number) => {
    const start = drag.current;
    if (!start) return null;
    const [x, y] = fieldPoint(box, clientX, clientY);
    const length = Math.hypot(x - start.x, y - start.y);
    if (length < DRAG_MIN) return null;
    return {
      angle: bearing([x, y], [start.x, start.y]),
      power: Math.round(Math.min(1, Math.max(MIN_POWER, length / DRAG_FULL)) * 100) / 100,
    };
  };

  const number = new Intl.NumberFormat(language);
  const metres = new Intl.NumberFormat(language, {
    style: "unit",
    unit: "meter",
    maximumFractionDigits: 1,
  });
  const degrees = new Intl.NumberFormat(language, {
    style: "unit",
    unit: "degree",
    unitDisplay: "narrow",
  });
  const percent = new Intl.NumberFormat(language, { style: "percent" });
  // Course units are ten centimetres.
  const away = (from: Point) => metres.format(distance(from, hole.cup) / 10);

  const played = v.cards.reduce((sum, card) => sum + card, 0);
  const parPlayed = v.course.slice(0, v.cards.length).reduce((sum, { par }) => sum + par, 0);
  const toPar = played - parPlayed;
  const toParText =
    v.cards.length === 0 || toPar === 0
      ? t("even")
      : toPar > 0
        ? `+${number.format(toPar)}`
        : `−${number.format(-toPar)}`;

  const hazards = [
    hole.water.length > 0 && t("hazard.water"),
    hole.sand.length > 0 && t("hazard.sand"),
    hole.slopes.length > 0 && t("hazard.slope"),
    hole.blocks.length > 0 && t("hazard.blocks"),
  ].filter((hazard): hazard is string => typeof hazard === "string");
  const where = {
    hole: holeIndex + 1,
    holes: v.course.length,
    par: hole.par,
  };
  const fieldName = [
    described
      ? t("field", {
          ...where,
          distance: away(described),
          bearing: degrees.format(bearing(described, hole.cup)),
        })
      : t("fieldHoled", where),
    hazards.length > 0
      ? t("hazards", {
          list: new Intl.ListFormat(language, { type: "conjunction" }).format(hazards),
        })
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  // What a shot that has landed did, for the banner and for a screen reader.
  const outcomeText = (shot: LastShot): string => {
    if (shot.outcome === "holed") {
      return shot.strokes === 1
        ? t("cup.ace")
        : t("cup.holed", {
            strokes: shot.strokes,
            term: t(`term.${termOf(shot.strokes, v.course[shot.hole].par)}`),
          });
    }
    if (shot.card !== null) return t("cup.pickedUp", { max: MAX_STROKES, cap: HOLE_CAP });
    if (shot.outcome === "water") return t("cup.splash");
    const end: Point = [shot.path[shot.path.length - 2], shot.path[shot.path.length - 1]];
    return t("cup.rest", { strokes: shot.strokes, distance: away(end) });
  };
  const settled = v.last !== null && !flying ? v.last : null;
  const bannerShot = finished ?? (v.over ? settled : null);

  const stats: [key: "hole" | "par" | "strokes" | "total", value: string][] = [
    ["hole", t("holeOf", { hole: holeIndex + 1, holes: v.course.length })],
    ["par", number.format(hole.par)],
    ["strokes", number.format(strokes)],
    ["total", toParText],
  ];

  // Where the last shot dropped or splashed, while its hole is on screen.
  const landing: Point | null =
    !flying && settled && settled.hole === holeIndex && settled.outcome !== "rest"
      ? settled.outcome === "holed"
        ? hole.cup
        : [settled.path[settled.path.length - 2], settled.path[settled.path.length - 1]]
      : null;
  const shine = `${ids}-shine`;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4">
      <dl aria-label={t("stats.label")} className="m-0 grid w-full grid-cols-4 gap-2">
        {stats.map(([key, value]) => (
          <div
            key={key}
            className="flex flex-col items-center rounded-[var(--radius-md)] bg-[var(--surface-2)] px-1 py-2 shadow-[var(--edge-highlight)]"
          >
            <dt className="sr-only">{t(`stats.${key}`)}</dt>
            {/* The word and the value share one element, with a real space between them, so
                the cell reads as "Strokes 2" to a test as well as to the eye. */}
            <dd className="m-0 flex flex-col items-center gap-0.5">
              <span
                aria-hidden="true"
                className="text-[0.65rem] font-bold tracking-[0.12em] text-[var(--text-muted)] uppercase"
              >
                {t(`stats.${key}`)}
              </span>{" "}
              <span className="font-display text-xl font-bold text-[var(--text-primary)] tabular-nums sm:text-2xl">
                {value}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      <svg
        role="img"
        aria-label={fieldName}
        viewBox={`0 0 ${FIELD_W} ${FIELD_H}`}
        className={`block w-full rounded-[var(--radius-lg)] shadow-[var(--shadow-inset),var(--shadow-2)] select-none ${
          canShoot ? "cursor-crosshair touch-none" : ""
        }`}
        style={{ background: "var(--board-well)", aspectRatio: `${FIELD_W} / ${FIELD_H}` }}
        onPointerDown={(event) => {
          if (!canShoot) return;
          const box = event.currentTarget as unknown as Box;
          const [x, y] = fieldPoint(box, event.clientX, event.clientY);
          drag.current = { pointer: event.pointerId, x, y };
          box.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (start?.pointer !== event.pointerId) return;
          const box = event.currentTarget as unknown as Box;
          const shot = pulled(box, event.clientX, event.clientY);
          // A drag this short is let go without shooting, so it draws no pull.
          if (!shot) {
            setPull(null);
            return;
          }
          setAngle(shot.angle);
          setPower(shot.power);
          setPull({ from: [start.x, start.y], to: fieldPoint(box, event.clientX, event.clientY) });
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointer !== event.pointerId) return;
          const shot = pulled(event.currentTarget as unknown as Box, event.clientX, event.clientY);
          drag.current = null;
          setPull(null);
          if (!shot) return;
          setAngle(shot.angle);
          setPower(shot.power);
          shoot(shot.angle, shot.power);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setPull(null);
        }}
      >
        <defs>
          <pattern id={`${ids}-ground`} width="6" height="6" patternUnits="userSpaceOnUse">
            <circle cx="3" cy="3" r="0.5" fill="var(--golf-ground-dot)" />
          </pattern>
          <radialGradient id={shine} cx="0.35" cy="0.3" r="0.75">
            <stop offset="0" stopColor="var(--golf-ball)" />
            <stop offset="0.55" stopColor="var(--golf-ball)" />
            <stop offset="1" stopColor="var(--golf-ball-shade)" />
          </radialGradient>
        </defs>
        <rect width={FIELD_W} height={FIELD_H} fill={`url(#${ids}-ground)`} />
        <g
          key={holeIndex}
          className="origin-center [transform-box:view-box] animate-[party-golf-course-in_var(--dur-slow)_var(--ease-out)_both]"
        >
          <Course hole={hole} ids={`${ids}-${holeIndex}`} />
        </g>
        {/* The drag itself, from where it started to where the pointer is now. */}
        {canShoot && pull && (
          <g stroke="var(--golf-glint)" strokeOpacity="0.55" strokeLinecap="round">
            <circle cx={pull.from[0]} cy={pull.from[1]} r="1.4" fill="none" strokeWidth="0.4" />
            <line
              x1={pull.from[0]}
              y1={pull.from[1]}
              x2={pull.to[0]}
              y2={pull.to[1]}
              strokeWidth="0.5"
              strokeDasharray="1 1.2"
            />
          </g>
        )}
        {canShoot && ball && <Aim ball={ball} angle={angle} power={power} />}
        {landing && settled?.outcome === "holed" && (
          <circle
            key={`sink-${v.shots}`}
            cx={landing[0]}
            cy={landing[1]}
            r={BALL_R}
            fill={`url(#${shine})`}
            stroke="var(--golf-ball-ring)"
            strokeWidth={0.35}
            className="origin-center [transform-box:fill-box] animate-[party-golf-sink_var(--dur-slow)_var(--ease-out)_both]"
          />
        )}
        {flying ? (
          <Flight key={v.shots} path={flying.path} shine={shine} onDone={landed} />
        ) : (
          ball && <Ball at={ball} shine={shine} />
        )}
        {landing && (
          <g key={v.shots}>
            <circle
              cx={landing[0]}
              cy={landing[1]}
              r={CUP_R}
              fill="none"
              stroke={settled?.outcome === "holed" ? "var(--golf-flag)" : "var(--golf-wave)"}
              strokeWidth="0.8"
              className={RIPPLE}
            />
            {settled?.outcome === "holed" ? (
              <Burst at={landing} colors={CONFETTI} reach={14} confetti />
            ) : (
              <Burst at={landing} colors={SPRAY} reach={7} confetti={false} />
            )}
          </g>
        )}
        <Flag cup={hole.cup} number={number.format(holeIndex + 1)} />
      </svg>

      {bannerShot && (
        <div className="flex flex-col items-center gap-2">
          <p
            className={`m-0 rounded-[var(--radius-pill)] px-4 py-1.5 text-center text-sm font-bold text-[var(--tile-ink)] ${
              bannerShot.outcome === "holed"
                ? "animate-[party-celebrate_var(--dur-slow)_var(--ease-bounce)_2] [background:var(--tile-32)]"
                : "[background:var(--tile-2)]"
            }`}
          >
            {outcomeText(bannerShot)}
          </p>
          {finished && (
            <button
              type="button"
              autoFocus
              onClick={() => {
                setFinished(null);
                (shootButton.current as Focusable | null)?.focus();
              }}
              className={`${BUTTON} ${PRIMARY} h-11 gap-2 rounded-[var(--radius-pill)] px-5 text-sm font-bold`}
            >
              {t("next")}
              <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      )}

      <div role="group" aria-label={t("controls")} className="flex w-full flex-col gap-3">
        <label className="flex items-center gap-3 text-sm font-bold text-[var(--text-secondary)]">
          <span className="w-14 shrink-0">{t("aim")}</span>
          <input
            type="range"
            min={0}
            max={359}
            step={1}
            value={angle}
            disabled={!canShoot}
            aria-valuetext={degrees.format(angle)}
            onChange={(event) => setAngle(Number(valueOf(event.currentTarget)))}
            className="h-11 min-w-0 flex-1 cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed"
          />
          <span aria-hidden="true" className="w-12 text-right tabular-nums">
            {degrees.format(angle)}
          </span>
        </label>
        <label className="flex items-center gap-3 text-sm font-bold text-[var(--text-secondary)]">
          <span className="w-14 shrink-0">{t("power")}</span>
          <input
            type="range"
            min={MIN_POWER * 100}
            max={100}
            step={1}
            value={Math.round(power * 100)}
            disabled={!canShoot}
            aria-valuetext={percent.format(power)}
            onChange={(event) => setPower(Number(valueOf(event.currentTarget)) / 100)}
            className="h-11 min-w-0 flex-1 cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed"
          />
          <span aria-hidden="true" className="w-12 text-right tabular-nums">
            {percent.format(power)}
          </span>
        </label>
        {/* Only disabled for good once the round is over. While a shot rolls it is merely
            marked so, which keeps a keyboard player's focus on it for the next one. */}
        <button
          ref={(element) => {
            shootButton.current = element;
          }}
          type="button"
          disabled={!playing}
          aria-disabled={!canShoot}
          onClick={() => shoot(angle, power)}
          className={`${BUTTON} ${PRIMARY} h-11 gap-2 self-center rounded-[var(--radius-pill)] px-8 text-sm font-bold aria-disabled:pointer-events-none aria-disabled:opacity-40`}
        >
          <span aria-hidden="true">⛳</span>
          {t("shoot")}
        </button>
      </div>

      {/* What the course's markings mean. Hidden from assistive technology, which hears the
          hole's hazards in the course's own name. */}
      {hazards.length > 0 && (
        <div
          aria-hidden="true"
          className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs font-semibold text-[var(--text-secondary)]"
        >
          {hole.water.length > 0 && (
            <Legend fill={`url(#${ids}-${holeIndex}-water)`}>{t("legend.water")}</Legend>
          )}
          {hole.sand.length > 0 && (
            <Legend fill={`url(#${ids}-${holeIndex}-sand)`}>{t("legend.sand")}</Legend>
          )}
          {hole.slopes.length > 0 && (
            <Legend fill={`url(#${ids}-${holeIndex}-slope-0)`} back="var(--golf-green)">
              {t("legend.slope")}
            </Legend>
          )}
        </div>
      )}

      <table className="w-full border-separate border-spacing-1 text-center text-sm tabular-nums">
        <caption className="sr-only">{t("scorecard.caption")}</caption>
        <thead>
          <tr>
            <th
              scope="row"
              className="text-left text-xs font-bold text-[var(--text-muted)] uppercase"
            >
              {t("scorecard.hole")}
            </th>
            {v.course.map((_, i) => (
              <th
                key={i}
                scope="col"
                className={`rounded-[var(--radius-sm)] py-1 font-display font-bold ${
                  i === holeIndex && !v.over
                    ? "bg-[var(--accent-soft)] text-[var(--accent-on-soft)]"
                    : "text-[var(--text-secondary)]"
                }`}
              >
                {number.format(i + 1)}
              </th>
            ))}
            <th scope="col" className="text-xs font-bold text-[var(--text-muted)] uppercase">
              {t("scorecard.total")}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th
              scope="row"
              className="text-left text-xs font-bold text-[var(--text-muted)] uppercase"
            >
              {t("scorecard.par")}
            </th>
            {v.course.map((h, i) => (
              <td key={i} className="text-[var(--text-secondary)]">
                {number.format(h.par)}
              </td>
            ))}
            <td className="font-bold text-[var(--text-secondary)]">{number.format(v.par)}</td>
          </tr>
          <tr>
            <th
              scope="row"
              className="text-left text-xs font-bold text-[var(--text-muted)] uppercase"
            >
              {t("scorecard.score")}
            </th>
            {v.course.map(({ par }, i) => (
              <td key={i} className="font-bold text-[var(--text-primary)]">
                {i < v.cards.length ? (
                  <span
                    className={`mx-auto flex size-7 items-center justify-center ${MARK[termOf(v.cards[i], par)]}`}
                  >
                    {number.format(v.cards[i])}
                  </span>
                ) : (
                  t("scorecard.none")
                )}
              </td>
            ))}
            <td className="font-bold text-[var(--text-primary)]">
              {v.cards.length > 0 ? number.format(played) : t("scorecard.none")}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="m-0 text-center text-sm font-semibold text-[var(--text-secondary)]">
        {v.over
          ? t("over")
          : status === "done"
            ? t("ended")
            : settled?.outcome === "water" && !finished
              ? t("cup.splash")
              : v.shots === 0
                ? t("hint", { max: MAX_STROKES, cap: HOLE_CAP })
                : null}
      </p>
      <p role="status" className="sr-only">
        {settled ? outcomeText(settled) : ""}
      </p>
    </div>
  );
}

function Legend({ fill, back, children }: { fill: string; back?: string; children: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg viewBox="0 0 8 8" className="size-4 rounded-[3px]">
        {back && <rect width="8" height="8" fill={back} />}
        <rect width="8" height="8" fill={fill} />
      </svg>
      {children}
    </span>
  );
}
