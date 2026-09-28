import { useTranslation } from "react-i18next";

import { BUTTON, PRIMARY } from "../../common/buttons";
import { MIN_POWER } from "../game";

// A slider's value, reached through a narrow type of its own: the Worker's
// type-check of this game has no DOM.
const valueOf = (input: unknown) => (input as { value: string }).value;

// The shot as two sliders, aim and power, and the button that hits it: the
// way to play for anyone not dragging on the course.
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
  const language = i18n.resolvedLanguage ?? "en";
  const degrees = new Intl.NumberFormat(language, {
    style: "unit",
    unit: "degree",
    unitDisplay: "narrow",
  });
  const percent = new Intl.NumberFormat(language, { style: "percent" });

  return (
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
          onChange={(event) => onAngle(Number(valueOf(event.currentTarget)))}
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
          onChange={(event) => onPower(Number(valueOf(event.currentTarget)) / 100)}
          className="h-11 min-w-0 flex-1 cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed"
        />
        <span aria-hidden="true" className="w-12 text-right tabular-nums">
          {percent.format(power)}
        </span>
      </label>
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
