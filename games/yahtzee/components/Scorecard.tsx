import { useTranslation } from "react-i18next";

import {
  LOWER,
  UPPER,
  UPPER_BONUS_AT,
  YAHTZEE_BONUS,
  isJoker,
  points,
  total,
  upperBonus,
  upperTotal,
} from "../game";
import type { Category, YahtzeeView } from "../game";
import { POINTS } from "../lines";
import { BoxRow } from "./BoxRow";
import { CardSection } from "./CardSection";
import { SumRow } from "./SumRow";

// The card: the upper section beside the lower one, each with what it adds
// up beneath it, and the total under both. Every box the dice may go in now
// offers what they would score there.
export function Scorecard({
  view: v,
  options,
  onScore,
}: {
  view: YahtzeeView;
  options: readonly Category[];
  onScore: (category: Category) => void;
}) {
  const { t, i18n } = useTranslation("yahtzee");
  const count = new Intl.NumberFormat(i18n.resolvedLanguage ?? "en");
  const { card, dice } = v;
  const joker = dice !== null && isJoker(card, dice);
  const upper = upperTotal(card);
  const bonus = upperBonus(card);
  const upperFull = UPPER.every((category) => card[category] !== undefined);

  const row = (category: Category) => (
    <BoxRow
      key={category}
      name={t(`box.${category}`)}
      scored={card[category]}
      preview={dice !== null && options.includes(category) ? points(category, dice, joker) : null}
      latest={v.last?.category === category}
      onScore={() => onScore(category)}
    />
  );

  return (
    <section aria-label={t("card.label")} className="flex w-full flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <CardSection title={t("card.upper")}>
          {UPPER.map(row)}
          <SumRow
            label={t("card.subtotal")}
            value={`${count.format(upper)}/${count.format(UPPER_BONUS_AT)}`}
          />
          <SumRow
            label={t("card.bonus")}
            value={bonus > 0 || upperFull ? count.format(bonus) : "–"}
            muted={bonus === 0}
          />
        </CardSection>
        <CardSection title={t("card.lower")}>
          {LOWER.map(row)}
          <SumRow
            label={t("card.yahtzeeBonus")}
            value={count.format(v.bonuses * YAHTZEE_BONUS)}
            muted={v.bonuses === 0}
          />
        </CardSection>
      </div>
      <p className="m-0 flex min-h-11 items-center justify-between gap-2 rounded-[var(--radius-xs)] border border-[var(--border-accent)] bg-[var(--accent-soft)] px-3 py-1">
        <span className="font-display font-bold text-[var(--text-primary)]">{t("card.total")}</span>{" "}
        <span className={`${POINTS} text-xl text-[var(--accent-on-soft)]`}>
          {count.format(total(card, v.bonuses))}
        </span>
      </p>
    </section>
  );
}
