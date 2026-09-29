import { useTranslation } from "react-i18next";

import { BUTTON, PRIMARY } from "../../common/buttons";

// The roll, with how many the round has left on a chip beside it.
export function RollButton({
  left,
  disabled,
  onRoll,
}: {
  left: number;
  disabled: boolean;
  onRoll: () => void;
}) {
  const { t } = useTranslation("yahtzee");
  return (
    <button
      type="button"
      aria-label={t("roll.label", { count: left })}
      disabled={disabled}
      onClick={onRoll}
      className={`${BUTTON} ${PRIMARY} h-12 gap-2 rounded-[var(--radius-pill)] px-6 font-display text-base font-bold`}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4ZM6.4 8a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0ZM10.4 12a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0ZM14.4 16a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0Z"
        />
      </svg>
      {t("roll.action")}
      <span
        aria-hidden="true"
        className="rounded-[var(--radius-pill)] px-2 py-0.5 font-sans text-xs tabular-nums"
        style={{ background: "color-mix(in oklab, currentColor 16%, transparent)" }}
      >
        {t("roll.left", { count: left })}
      </span>
    </button>
  );
}
