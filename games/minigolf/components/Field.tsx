import { useRef, useState } from "react";

import { BALL_R, FIELD_H, FIELD_W, MIN_POWER } from "../game";
import type { Hole, LastShot, Point } from "../game";
import { bearing } from "../geometry";
import { Aim } from "./Aim";
import { Ball } from "./Ball";
import { Course } from "./Course";
import { Flag } from "./Flag";
import { Flight } from "./Flight";
import { Landing } from "./Landing";

// The field, as far as turning a pointer into a point on the course goes.
// Reached through a narrow type of its own: the Worker's type-check of this
// game has no DOM.
interface Box {
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  setPointerCapture?(pointer: number): void;
}

// How far back, in course units, a drag goes for a full-power shot, and how
// short a drag is let go without shooting.
const DRAG_FULL = 40;
const DRAG_MIN = 3;

// The course as a picture, and the slingshot drag that aims and hits a shot
// on it: dragging back from anywhere aims the ball the opposite way, as hard
// as it was pulled, and letting go shoots. The drag lives here; the aim it
// sets is the page's, so the sliders follow it.
export function Field({
  ids,
  label,
  hole,
  holeIndex,
  holeNumber,
  shots,
  canShoot,
  ball,
  angle,
  power,
  flying,
  landing,
  holed,
  onAim,
  onShoot,
  onLanded,
}: {
  // Prefixes every id the picture defines, so two fields on a page stay apart.
  ids: string;
  label: string;
  hole: Hole;
  holeIndex: number;
  holeNumber: string;
  // The run's shot count, which keys a fresh playback and landing per shot.
  shots: number;
  canShoot: boolean;
  ball: Point | null;
  angle: number;
  power: number;
  flying: LastShot | null;
  landing: Point | null;
  holed: boolean;
  onAim: (angle: number, power: number) => void;
  onShoot: (angle: number, power: number) => void;
  onLanded: () => void;
}) {
  const drag = useRef<{ pointer: number; x: number; y: number } | null>(null);
  const [pull, setPull] = useState<{ from: Point; to: Point } | null>(null);
  const shine = `${ids}-shine`;

  const fieldPoint = (box: Box, clientX: number, clientY: number): Point => {
    const rect = box.getBoundingClientRect();
    return [
      ((clientX - rect.left) / rect.width) * FIELD_W,
      ((clientY - rect.top) / rect.height) * FIELD_H,
    ];
  };
  // A drag, from where it started to where the pointer is, as the shot it
  // would be.
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

  return (
    <svg
      role="img"
      aria-label={label}
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
        onAim(shot.angle, shot.power);
        setPull({ from: [start.x, start.y], to: fieldPoint(box, event.clientX, event.clientY) });
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointer !== event.pointerId) return;
        const shot = pulled(event.currentTarget as unknown as Box, event.clientX, event.clientY);
        drag.current = null;
        setPull(null);
        if (!shot) return;
        onAim(shot.angle, shot.power);
        onShoot(shot.angle, shot.power);
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
      {landing && holed && (
        // The ball dropping into the cup.
        <circle
          key={`sink-${shots}`}
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
        <Flight key={shots} path={flying.path} shine={shine} onDone={onLanded} />
      ) : (
        ball && <Ball at={ball} shine={shine} />
      )}
      {landing && <Landing key={shots} at={landing} holed={holed} />}
      <Flag cup={hole.cup} number={holeNumber} />
    </svg>
  );
}
