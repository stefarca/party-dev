import { useEffect, useId, useRef, useState } from "react";
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

function Ball({ at }: { at: Point }) {
  return (
    <g>
      <ellipse
        cx={at[0] + 0.4}
        cy={at[1] + 0.6}
        rx={BALL_R}
        ry={BALL_R * 0.8}
        fill="var(--golf-shadow)"
      />
      <circle
        cx={at[0]}
        cy={at[1]}
        r={BALL_R}
        fill="var(--golf-ball)"
        stroke="var(--golf-ball-ring)"
        strokeWidth={0.4}
      />
    </g>
  );
}

// The ball rolling along `path`, played back in real time. Calls `onDone`
// once it has reached the end, straight away when motion is reduced.
function Flight({ path, onDone }: { path: number[]; onDone: () => void }) {
  const [at, setAt] = useState<Point>([path[0], path[1]]);
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
      const along = Math.min((time - start) / SAMPLE_MS, last);
      const i = Math.floor(along);
      const j = Math.min(i + 1, last);
      const f = along - i;
      setAt([
        path[2 * i] + (path[2 * j] - path[2 * i]) * f,
        path[2 * i + 1] + (path[2 * j + 1] - path[2 * i + 1]) * f,
      ]);
      if (along >= last) done.current();
      else handle = clock.requestAnimationFrame(frame);
    };
    handle = clock.requestAnimationFrame(frame);
    return () => clock.cancelAnimationFrame(handle);
  }, [path]);

  return <Ball at={at} />;
}

function Course({ hole, ids }: { hole: Hole; ids: string }) {
  return (
    <>
      <defs>
        <pattern id={`${ids}-mow`} width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill="var(--golf-green)" />
          <rect width="12" height="6" fill="var(--golf-stripe)" />
        </pattern>
        <pattern id={`${ids}-sand`} width="3" height="3" patternUnits="userSpaceOnUse">
          <rect width="3" height="3" fill="var(--golf-sand)" />
          <circle cx="0.8" cy="0.8" r="0.35" fill="var(--golf-sand-grain)" />
          <circle cx="2.3" cy="2.2" r="0.3" fill="var(--golf-sand-grain)" />
        </pattern>
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
        {hole.slopes.map((slope, i) => (
          <pattern
            key={i}
            id={`${ids}-slope-${i}`}
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
            patternTransform={`rotate(${fallRotation(slope.fall)})`}
          >
            <path
              d="M1.5 2.5 L4 5 L6.5 2.5"
              fill="none"
              stroke="var(--golf-slope)"
              strokeWidth="0.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </pattern>
        ))}
      </defs>

      {/* The outline is stroked first and filled over, so its wall shows only outside the
          course: the ball rolls right up to the line it bounces off. */}
      <polygon
        points={points(hole.edge)}
        fill="var(--golf-wall)"
        stroke="var(--golf-wall)"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <polygon points={points(hole.edge)} fill={`url(#${ids}-mow)`} />
      {hole.slopes.map((slope, i) => (
        <g key={i}>
          <polygon points={points(slope.area)} fill="var(--golf-slope-tint)" />
          <polygon points={points(slope.area)} fill={`url(#${ids}-slope-${i})`} />
        </g>
      ))}
      {hole.sand.map((area, i) => (
        <polygon key={i} points={points(area)} fill={`url(#${ids}-sand)`} />
      ))}
      {hole.water.map((area, i) => (
        <polygon key={i} points={points(area)} fill={`url(#${ids}-water)`} />
      ))}
      {hole.blocks.map((area, i) => (
        <polygon key={i} points={points(area)} fill="var(--golf-wall)" />
      ))}
      <rect
        x={hole.tee[0] - 4}
        y={hole.tee[1] - 2.5}
        width="8"
        height="5"
        rx="1"
        fill="var(--golf-tee)"
      />
      <circle cx={hole.cup[0]} cy={hole.cup[1]} r={CUP_R} fill="var(--board-hole)" />
    </>
  );
}

function Flag({ cup }: { cup: Point }) {
  const [x, y] = cup;
  return (
    <g>
      <line
        x1={x}
        y1={y}
        x2={x}
        y2={y - 11}
        stroke="var(--golf-pole)"
        strokeWidth="0.6"
        strokeLinecap="round"
      />
      <path
        d={`M${x} ${y - 11} L${x + 6} ${y - 9} L${x} ${y - 7} Z`}
        fill="var(--golf-flag)"
        stroke="var(--golf-ball-ring)"
        strokeWidth="0.4"
        strokeLinejoin="round"
      />
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

  const radians = (angle * Math.PI) / 180;
  const arrow = ARROW_MIN + (ARROW_MAX - ARROW_MIN) * power;

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
          if (drag.current?.pointer !== event.pointerId) return;
          const shot = pulled(event.currentTarget as unknown as Box, event.clientX, event.clientY);
          if (!shot) return;
          setAngle(shot.angle);
          setPower(shot.power);
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointer !== event.pointerId) return;
          const shot = pulled(event.currentTarget as unknown as Box, event.clientX, event.clientY);
          drag.current = null;
          if (!shot) return;
          setAngle(shot.angle);
          setPower(shot.power);
          shoot(shot.angle, shot.power);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <Course key={holeIndex} hole={hole} ids={`${ids}-${holeIndex}`} />
        {canShoot && ball && (
          <g opacity="0.85">
            <line
              x1={ball[0]}
              y1={ball[1]}
              x2={ball[0] + Math.sin(radians) * arrow}
              y2={ball[1] - Math.cos(radians) * arrow}
              stroke="var(--golf-ball)"
              strokeWidth="0.8"
              strokeDasharray="1.6 1.4"
              strokeLinecap="round"
            />
            <circle
              cx={ball[0] + Math.sin(radians) * arrow}
              cy={ball[1] - Math.cos(radians) * arrow}
              r="1"
              fill="var(--golf-ball)"
            />
          </g>
        )}
        {flying ? (
          <Flight key={v.shots} path={flying.path} onDone={landed} />
        ) : (
          ball && <Ball at={ball} />
        )}
        {!flying && settled && settled.hole === holeIndex && settled.outcome !== "rest" && (
          <circle
            key={v.shots}
            cx={settled.outcome === "holed" ? hole.cup[0] : settled.path[settled.path.length - 2]}
            cy={settled.outcome === "holed" ? hole.cup[1] : settled.path[settled.path.length - 1]}
            r={CUP_R}
            fill="none"
            stroke={settled.outcome === "holed" ? "var(--golf-flag)" : "var(--golf-wave)"}
            strokeWidth="0.8"
            className={RIPPLE}
          />
        )}
        <Flag cup={hole.cup} />
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
            {v.course.map((_, i) => (
              <td key={i} className="font-bold text-[var(--text-primary)]">
                {i < v.cards.length ? number.format(v.cards[i]) : t("scorecard.none")}
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
