import { useTranslation } from "react-i18next";

import { BUTTON, PLAIN, PRIMARY } from "../../common/buttons";
import { NAME, PALETTE } from "../colors";
import type { Draft } from "../useDraft";
import { Peg } from "./Peg";

// The peg tray: a button per colour, numbered for the keyboard, then Erase
// and Check.
export function Tray({ draft }: { draft: Draft }) {
  const { t } = useTranslation("mastermind");
  const { canEdit, full, used } = draft;
  return (
    <div className="flex w-full flex-col items-center gap-3 sm:w-auto">
      <div
        role="group"
        aria-label={t("palette")}
        className="grid w-full grid-cols-7 gap-1.5 sm:w-[7.5rem] sm:grid-cols-2"
      >
        {PALETTE.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={t(NAME[color])}
            disabled={!canEdit || full || used.has(color)}
            onClick={() => draft.pick(color)}
            className={`${BUTTON} ${PLAIN} h-16 flex-col gap-1 rounded-[var(--radius-sm)] px-1 sm:h-14`}
          >
            <span className="block size-9 max-w-full">
              <Peg color={color} />
            </span>
            <span
              aria-hidden="true"
              className="text-[0.6rem] leading-none font-bold text-[var(--text-muted)] tabular-nums"
            >
              {color + 1}
            </span>
          </button>
        ))}
      </div>

      <div className="flex gap-2 sm:w-full sm:flex-col">
        <button
          type="button"
          disabled={!canEdit || used.size === 0}
          onClick={() => draft.erase()}
          className={`${BUTTON} ${PLAIN} h-11 gap-2 rounded-[var(--radius-pill)] px-4 text-sm font-bold sm:px-2`}
        >
          <span aria-hidden="true">⌫</span>
          {t("erase")}
        </button>
        <button
          type="button"
          disabled={!canEdit || !full}
          onClick={() => draft.check()}
          className={`${BUTTON} ${PRIMARY} h-11 gap-2 rounded-[var(--radius-pill)] px-5 text-sm font-bold sm:px-2`}
        >
          <span aria-hidden="true">✓</span>
          {t("check")}
        </button>
      </div>
    </div>
  );
}
