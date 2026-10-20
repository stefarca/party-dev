import { useId } from "react";
import { useTranslation } from "react-i18next";

import { BUTTON, PRIMARY } from "../../common/buttons";
import { MIN_REACH, powerOf, reachOf } from "../power";
import { Nudge } from "./Nudge";

// A slider's value, reached through a narrow type of its own: the Worker's
// type-check of this game has no DOM.
const valueOf = (input: unknown) => (input as { value: string }).value;

// The aim slider is centred on the cup, the way every lie starts aimed: right
// of centre turns clockwise from it, left of centre anticlockwise, and both
// ends point straight away from it, so the thumb starts in the middle on every
// lie and only wraps round on a shot hit away from the cup. The track is finer
// near its centre, where most aiming happens: its middle half turns the aim up
// to 67.5° either way, the outer quarters the rest. A position is a step of
// the track, 0 to ±STEPS; the shot itself stays a compass bearing, 0 to 360.
const STEPS = 180;
// The turn from the cup at a track position, and the position of a turn.
const turnAt = (position: number) => {
  const s = Math.abs(position) / STEPS;
  return Math.sign(position) * 90 * (s + s * s);
};
const positionOf = (turn: number) =>
  Math.sign(turn) * STEPS * ((Math.sqrt(1 + (8 * Math.abs(turn)) / 180) - 1) / 2);
// A bearing as a turn from `centre`, in (-180, 180].
const turnFrom = (centre: number, bearing: number) => {
  const turn = (((bearing - centre) % 360) + 360) % 360;
  return turn > 180 ? turn - 360 : turn;
};
const toBearing = (degrees: number) => ((degrees % 360) + 360) % 360;
// A bearing as shown: whole degrees, 0 to 359, the way the course names the
// cup's, so the two can be compared.
const shown = (bearing: number) => Math.round(bearing) % 360;

// The shot as two sliders, aim and power, and the button that hits it: the
// way to play for anyone not dragging on the course. Power is set by reach,
// how far the ball will roll, which is what a player is judging; each slider
// has a button either side that moves it by one step.
export function ShotControls({
  angle,
  centre,
  power,
  playing,
  canShoot,
  onAngle,
  onPower,
  onShoot,
  shootRef,
}: {
  angle: number;
  centre: number;
  power: number;
  playing: boolean;
  canShoot: boolean;
  onAngle: (angle: number) => void;
  onPower: (power: number) => void;
  onShoot: () => void;
  shootRef: (element: unknown) => void;
}) {
  const { t, i18n } = useTranslation("minigolf");
  const id = useId();
  const language = i18n.resolvedLanguage ?? "en";
  const degrees = new Intl.NumberFormat(language, {
    style: "unit",
    unit: "degree",
    unitDisplay: "narrow",
  });
  const percent = new Intl.NumberFormat(language, { style: "percent" });
  const position = Math.round(positionOf(turnFrom(centre, angle)));
  const reach = Math.round(reachOf(power) * 100);
  const setReach = (percent: number) =>
    onPower(powerOf(Math.min(100, Math.max(MIN_REACH * 100, percent)) / 100));

  return (
    <div role="group" aria-label={t("controls")} className="flex w-full flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-bold text-[var(--text-secondary)]">
        <span id={`${id}-aim`} className="w-12 shrink-0">
          {t("aim")}
        </span>
        <Nudge
          label={t("nudge.anticlockwise")}
          glyph="↺"
          disabled={!canShoot}
          onClick={() => onAngle(toBearing(angle - 1))}
        />
        <input
          type="range"
          min={-STEPS}
          max={STEPS}
          step={1}
          value={position}
          aria-labelledby={`${id}-aim`}
          disabled={!canShoot}
          aria-valuetext={degrees.format(shown(angle))}
          onChange={(event) =>
            onAngle(toBearing(centre + turnAt(Number(valueOf(event.currentTarget)))))
          }
          className="h-11 min-w-0 flex-1 cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed"
        />
        <Nudge
          label={t("nudge.clockwise")}
          glyph="↻"
          disabled={!canShoot}
          onClick={() => onAngle(toBearing(angle + 1))}
        />
        <span aria-hidden="true" className="w-12 text-right tabular-nums">
          {degrees.format(shown(angle))}
        </span>
      </div>
      <div className="flex items-center gap-2 text-sm font-bold text-[var(--text-secondary)]">
        <span id={`${id}-power`} className="w-12 shrink-0">
          {t("power")}
        </span>
        <Nudge
          label={t("nudge.softer")}
          glyph="−"
          disabled={!canShoot}
          onClick={() => setReach(reach - 1)}
        />
        <input
          type="range"
          min={MIN_REACH * 100}
          max={100}
          step={1}
          value={reach}
          aria-labelledby={`${id}-power`}
          disabled={!canShoot}
          aria-valuetext={percent.format(reach / 100)}
          onChange={(event) => setReach(Number(valueOf(event.currentTarget)))}
          className="h-11 min-w-0 flex-1 cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed"
        />
        <Nudge
          label={t("nudge.harder")}
          glyph="+"
          disabled={!canShoot}
          onClick={() => setReach(reach + 1)}
        />
        <span aria-hidden="true" className="w-12 text-right tabular-nums">
          {percent.format(reach / 100)}
        </span>
      </div>
      {/* Only disabled for good once the round is over. While a shot rolls it is merely
          marked so, which keeps a keyboard player's focus on it for the next one. */}
      <button
        ref={shootRef}
        type="button"
        disabled={!playing}
        aria-disabled={!canShoot}
        onClick={onShoot}
        className={`${BUTTON} ${PRIMARY} h-11 gap-2 self-center rounded-[var(--radius-pill)] px-8 text-sm font-bold aria-disabled:pointer-events-none aria-disabled:opacity-40`}
      >
        <span aria-hidden="true">⛳</span>
        {t("shoot")}
      </button>
    </div>
  );
}
