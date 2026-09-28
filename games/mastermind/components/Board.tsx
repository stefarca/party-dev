import { useTranslation } from "react-i18next";

import { MAX_GUESSES } from "../game";
import type { MastermindView } from "../game";
import type { Draft } from "../useDraft";
import { DraftRow } from "./DraftRow";
import { EmptyRow } from "./EmptyRow";
import { GuessRow } from "./GuessRow";

// Every row of the board, top to bottom: the guesses made, the one being
// built while the run is on, and the rows still to come.
export function Board({
  view: v,
  playable,
  draft,
}: {
  view: MastermindView;
  playable: boolean;
  draft: Draft;
}) {
  const { t } = useTranslation("mastermind");
  const current = v.guesses.length;
  // Rows after the current one, still empty; the current one too once the run is over.
  const emptyRows = MAX_GUESSES - current - (playable ? 1 : 0);
  return (
    <div className="@container w-full sm:max-w-[22rem]">
      <section
        aria-label={t("board")}
        className="flex w-full flex-col gap-[0.8cqw] rounded-[var(--radius-lg)] border-4 p-[2cqw] shadow-[var(--shadow-inset),var(--shadow-2)] select-none"
        style={{ background: "var(--board-well)", borderColor: "var(--board-rim)" }}
      >
        {current > 0 && (
          <ol aria-label={t("guesses")} className="m-0 flex list-none flex-col gap-[0.8cqw] p-0">
            {v.guesses.map((guess, index) => (
              <GuessRow key={index} guess={guess} index={index} latest={index === current - 1} />
            ))}
          </ol>
        )}
        {playable && <DraftRow number={current + 1} draft={draft} />}
        {Array.from({ length: Math.max(0, emptyRows) }, (_, i) => (
          <EmptyRow key={i} number={current + (playable ? 2 : 1) + i} />
        ))}
      </section>
    </div>
  );
}
