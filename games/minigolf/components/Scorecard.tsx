import { useTranslation } from "react-i18next";

import type { MinigolfView } from "../game";
import { termOf } from "../scoring";
import type { Term } from "../scoring";

// A hole's score marked the way a paper scorecard marks it: ringed under
// par and boxed over it, twice for two strokes or more either way.
const MARK: Record<Term, string> = {
  eagle: "rounded-full border-4 border-double border-[var(--ok-fg)]",
  birdie: "rounded-full border-2 border-[var(--ok-fg)]",
  par: "",
  bogey: "rounded-[4px] border-2 border-[var(--warn-fg)]",
  double: "rounded-[4px] border-4 border-double border-[var(--warn-fg)]",
  triple: "rounded-[4px] border-4 border-double border-[var(--danger-fg)]",
};

// The round's scorecard: every hole's par and, once it is played, its score,
// with the hole being played picked out.
export function Scorecard({ view: v, holeIndex }: { view: MinigolfView; holeIndex: number }) {
  const { t, i18n } = useTranslation("minigolf");
  const number = new Intl.NumberFormat(i18n.resolvedLanguage ?? "en");
  const played = v.cards.reduce((sum, card) => sum + card, 0);
  return (
    <table className="w-full border-separate border-spacing-1 text-center text-sm tabular-nums">
      <caption className="sr-only">{t("scorecard.caption")}</caption>
      <thead>
        <tr>
          <th
            scope="row"
            className="text-left text-xs font-bold text-[var(--text-muted)] uppercase"
          >
            {t("scorecard.hole")}
          </th>
          {v.course.map((_, i) => (
            <th
              key={i}
              scope="col"
              className={`rounded-[var(--radius-sm)] py-1 font-display font-bold ${
                i === holeIndex && !v.over
                  ? "bg-[var(--accent-soft)] text-[var(--accent-on-soft)]"
                  : "text-[var(--text-secondary)]"
              }`}
            >
              {number.format(i + 1)}
            </th>
          ))}
          <th scope="col" className="text-xs font-bold text-[var(--text-muted)] uppercase">
            {t("scorecard.total")}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th
            scope="row"
            className="text-left text-xs font-bold text-[var(--text-muted)] uppercase"
          >
            {t("scorecard.par")}
          </th>
          {v.course.map((h, i) => (
            <td key={i} className="text-[var(--text-secondary)]">
              {number.format(h.par)}
            </td>
          ))}
          <td className="font-bold text-[var(--text-secondary)]">{number.format(v.par)}</td>
        </tr>
        <tr>
          <th
            scope="row"
            className="text-left text-xs font-bold text-[var(--text-muted)] uppercase"
          >
            {t("scorecard.score")}
          </th>
          {v.course.map(({ par }, i) => (
            <td key={i} className="font-bold text-[var(--text-primary)]">
              {i < v.cards.length ? (
                <span
                  className={`mx-auto flex size-7 items-center justify-center ${MARK[termOf(v.cards[i], par)]}`}
                >
                  {number.format(v.cards[i])}
                </span>
              ) : (
                t("scorecard.none")
              )}
            </td>
          ))}
          <td className="font-bold text-[var(--text-primary)]">
            {v.cards.length > 0 ? number.format(played) : t("scorecard.none")}
          </td>
        </tr>
      </tbody>
    </table>
  );
}
