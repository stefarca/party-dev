import { BUTTON, PLAIN } from "../../common/buttons";

// A small button beside a slider that moves it one step, for a touch screen,
// where a slider's thumb is too coarse to land on a single degree.
export function Nudge({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string;
  glyph: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`${BUTTON} ${PLAIN} size-9 shrink-0 rounded-full text-base font-bold`}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}
