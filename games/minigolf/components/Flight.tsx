import { useEffect, useRef, useState } from "react";

import { BALL_R, SAMPLE_MS } from "../game";
import type { Point } from "../game";
import { frameClock, prefersReducedMotion } from "../motion";
import { Ball } from "./Ball";

// How many of the path's samples the rolling ball's trail reaches back.
const TRAIL = 10;

// The ball rolling along `path`, played back in real time, with a trail
// fading out behind it. Calls `onDone` once it has reached the end,
// straight away when motion is reduced.
export function Flight({
  path,
  shine,
  onDone,
}: {
  path: number[];
  shine: string;
  onDone: () => void;
}) {
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
      else handle = frameClock.requestAnimationFrame(frame);
    };
    handle = frameClock.requestAnimationFrame(frame);
    return () => frameClock.cancelAnimationFrame(handle);
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
