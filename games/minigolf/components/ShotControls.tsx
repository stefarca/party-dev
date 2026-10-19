import { useId } from "react";
import { useTranslation } from "react-i18next";

import { BUTTON, PRIMARY } from "../../common/buttons";
import { MIN_REACH, powerOf, reachOf } from "../power";
import { Nudge } from "./Nudge";

// A slider's value, reached through a narrow type of its own: the Worker's
// type-check of this game has no DOM.
const valueOf = (input: unknown) => (input as { value: string }).value;

// The aim slider is centred on straight up, which is where most shots go:
// right of centre turns clockwise, left of centre anticlockwise, and both ends
// point straight down. The shot itself stays a compass bearing, 0 to 359.
const toSlider = (bearing: number) => (bearing > 180 ? bearing - 360 : bearing);
const toBearing = (slider: number) => (slider + 360) % 360;

// The shot as two sliders, aim and power, and the button that hits it: the
// way to play for anyone not dragging on the course. Power is set by reach,
// how far the ball will roll, which is what a player is judging; each slider
// has a button either side that moves it by one step.
export function ShotControls({
  angle,
  power,
  playing,
  canShoot,
  onAngle,
  onPower,
  onShoot,
  shootRef,
}: {
  angle: number;
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
  const turn = toSlider(angle);
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
          onClick={() => onAngle(toBearing(turn - 1))}
        />
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={turn}
          aria-labelledby={`${id}-aim`}
          disabled={!canShoot}
          aria-valuetext={degrees.format(turn)}
          onChange={(event) => onAngle(toBearing(Number(valueOf(event.currentTarget))))}
          className="h-11 min-w-0 flex-1 cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed"
        />
        <Nudge
          label={t("nudge.clockwise")}
          glyph="↻"
          disabled={!canShoot}
          onClick={() => onAngle(toBearing(turn + 1))}
        />
        <span aria-hidden="true" className="w-12 text-right tabular-nums">
          {degrees.format(turn)}
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
