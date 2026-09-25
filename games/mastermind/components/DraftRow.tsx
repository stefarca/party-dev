import { useTranslation } from "react-i18next";

import { NAME } from "../colors";
import { MAX_GUESSES } from "../game";
import { HOLES, NUMBER, ROW } from "../rows";
import type { Draft } from "../useDraft";
import { Hole } from "./Hole";
import { Marks } from "./Marks";
import { Peg } from "./Peg";

// The row being filled, picked out on the board. Each filled hole is a
// button that takes its peg out again.
export function DraftRow({ number, draft }: { number: number; draft: Draft }) {
  const { t } = useTranslation("mastermind");
  return (
    <div
      role="group"
      aria-label={t("draft.label", { number, count: MAX_GUESSES })}
      className={ROW}
      style={{
        background: "color-mix(in oklab, var(--board-mark) 30%, transparent)",
        outline: "2px solid var(--board-mark)",
      }}
    >
      <span aria-hidden="true" className={NUMBER}>
        {number}
      </span>
      <span className={HOLES}>
        {draft.pegs.map((color, slot) => (
          <button
            key={slot}
            type="button"
            disabled={!draft.canEdit || color === null}
            aria-label={
              color === null
                ? t("draft.empty", { slot: slot + 1 })
                : t("draft.filled", { slot: slot + 1, color: t(NAME[color]) })
            }
            onClick={() => draft.clear(slot)}
            className="aspect-square cursor-pointer rounded-full p-0 touch-manipulation disabled:cursor-default"
          >
            {color === null ? <Hole /> : <Peg key={color} color={color} pop />}
          </button>
        ))}
      </span>
      <Marks guess={null} />
    </div>
  );
}
