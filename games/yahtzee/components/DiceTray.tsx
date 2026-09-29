import { useTranslation } from "react-i18next";

import { DICE } from "../game";
import type { YahtzeeView } from "../game";
import type { Turn } from "../useTurn";
import { Die } from "./Die";

// The five dice on the board's felt, each a toggle button that holds it.
export function DiceTray({ view: v, turn }: { view: YahtzeeView; turn: Turn }) {
  const { t } = useTranslation("yahtzee");
  return (
    <div className="@container w-full">
      <div
        role="group"
        aria-label={t("dice")}
        className="flex w-full gap-[3cqw] rounded-[var(--radius-lg)] border-4 px-[3.5cqw] pt-[4.5cqw] pb-[2.5cqw] shadow-[var(--shadow-inset),var(--shadow-2)] select-none"
        style={{ background: "var(--board-well)", borderColor: "var(--board-rim)" }}
      >
        {Array.from({ length: DICE }, (_, die) => (
          <Die
            key={die}
            index={die}
            face={v.dice?.[die] ?? null}
            held={turn.held[die]}
            thrown={v.rolls > 0 && !v.held[die]}
            throwKey={`${v.round}:${v.rolls}`}
            rattling={turn.rolling && !turn.held[die]}
            disabled={!turn.canHold}
            onToggle={() => turn.toggle(die)}
          />
        ))}
      </div>
    </div>
  );
}
