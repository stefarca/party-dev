import { useTranslation } from "react-i18next";

import { BUTTON, PLAIN } from "../../common/buttons";
import { DIGITS } from "../digits";
import { SIZE } from "../game";

// The nine digits, each with how many of it the grid still needs. A digit
// the grid has all of is dimmed. In notes mode the digits are drawn lighter,
// the way a pencil mark is.
export function DigitPad({
  values,
  notesMode,
  disabled,
  onEnter,
}: {
  values: number[];
  notesMode: boolean;
  disabled: boolean;
  onEnter: (digit: number) => void;
}) {
  const { t } = useTranslation("sudoku");
  return (
    <div role="group" aria-label={t("pad.label")} className="grid w-full grid-cols-9 gap-1.5">
      {DIGITS.map((digit) => {
        const toGo = Math.max(0, SIZE - values.filter((value) => value === digit).length);
        return (
          <button
            key={digit}
            type="button"
            aria-label={t("pad.digit", { digit, count: toGo })}
            disabled={disabled}
            onClick={() => onEnter(digit)}
            className={`${BUTTON} ${PLAIN} h-14 flex-col gap-0.5 rounded-[var(--radius-sm)] px-0 ${
              toGo === 0 ? "opacity-60" : ""
            }`}
          >
            <span
              aria-hidden="true"
              className={`font-display leading-none tabular-nums ${
                notesMode
                  ? "text-base font-medium text-[var(--text-secondary)]"
                  : "text-xl font-bold"
              }`}
            >
              {digit}
            </span>
            <span
              aria-hidden="true"
              className="text-[0.6rem] leading-none font-bold text-[var(--text-muted)] tabular-nums"
            >
              {toGo}
            </span>
          </button>
        );
      })}
    </div>
  );
}
