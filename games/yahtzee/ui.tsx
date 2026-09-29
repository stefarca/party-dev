import { useTranslation } from "react-i18next";

import type { DailyUiProps } from "../../shared/protocol";
import { Banner } from "../common/Banner";
import { closest, isForTheBoard, useWindowKeys } from "../common/keyboard";
import { Loading } from "../common/Loading";
import { Stats } from "../common/Stats";
import { StatusLine } from "../common/StatusLine";
import { DiceTray } from "./components/DiceTray";
import { RollButton } from "./components/RollButton";
import { Scorecard } from "./components/Scorecard";
import { LOWER, ROLLS, ROUNDS, UPPER, earnsBonus, isJoker, isYahtzee, total } from "./game";
import type { YahtzeeView } from "./game";
import type strings from "./locales/en.json";
import { useTurn } from "./useTurn";

declare module "i18next" {
  interface ResourceNamespaceMap {
    yahtzee: typeof strings;
  }
}

// The Yahtzee table: five dice on the felt, the roll beneath them, and the
// card below that. A tap on a die holds it for the next roll; a tap on a box
// of the card scores the dice there, and the card offers what each open box
// would make of them. Rolls and scores go to the server, which alone knows
// the faces still to come, so the dice land once the roll does.
//
// Every die is a toggle button whose name says its face and whose pressed
// state says it is held; every box on offer is a button that says what it
// would score.

// Enter on a focused button presses that button, and must not roll as well.
const PRESSES_ENTER = "button, a, [role='button']";

export default function YahtzeeUi({ view, status, send }: DailyUiProps) {
  const { t, i18n } = useTranslation("yahtzee");
  const v = view as YahtzeeView | null;
  const over = v !== null && v.round >= ROUNDS;
  const playable = status === "active" && v !== null && !over;
  const turn = useTurn(v, playable, send);

  // A die held by its number, and a roll, from anywhere on the page.
  useWindowKeys(playable, (event) => {
    if (!isForTheBoard(event)) return;
    if (/^[1-5]$/.test(event.key)) turn.toggle(Number(event.key) - 1);
    else if (event.key === "r" || event.key === "R") turn.roll();
    else if (event.key === "Enter" && !closest(event, PRESSES_ENTER)) turn.roll();
    else return;
    event.preventDefault();
  });

  if (!v) return <Loading label={t("loading")} />;

  const count = new Intl.NumberFormat(i18n.resolvedLanguage ?? "en");
  const score = total(v.card, v.bonuses);
  const stats: [key: "round" | "score", value: string][] = [
    ["round", `${count.format(Math.min(v.round + 1, ROUNDS))}/${count.format(ROUNDS)}`],
    ["score", count.format(score)],
  ];

  const { card, dice } = v;
  const yahtzee = playable && dice !== null && isYahtzee(dice);
  // What to do now, until the card is full and the banner says how it went.
  // A joker's box is the rules' to choose, so it says which.
  let message: string | null = null;
  if (!over) {
    if (status === "done") message = t("ended");
    else if (dice === null) {
      message = v.round === 0 ? t("hint") : t("next", { round: v.round + 1, count: ROUNDS });
    } else if (isJoker(card, dice)) {
      const own = UPPER[dice[0] - 1];
      if (card[own] === undefined) message = t("joker.upper", { box: t(`box.${own}`) });
      else if (LOWER.some((category) => card[category] === undefined)) message = t("joker.lower");
      else message = t("joker.zero");
    } else message = v.rolls < ROLLS ? t("hold") : t("pick");
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 sm:max-w-lg sm:gap-4">
      <Stats
        label={t("stats.label")}
        stats={stats.map(([key, value]) => ({ key, label: t(`stats.${key}`), value }))}
      />
      <DiceTray view={v} turn={turn} />
      <RollButton left={ROLLS - v.rolls} disabled={!turn.canRoll} onRoll={() => turn.roll()} />
      {yahtzee && (
        <Banner fill="var(--tile-128)" celebrate>
          {earnsBonus(card, dice) ? t("yahtzeeBonus") : t("yahtzee")}
        </Banner>
      )}
      {over && (
        <Banner fill="var(--tile-32)" celebrate>
          {t("final", { count: score })}
        </Banner>
      )}
      {message && <StatusLine>{message}</StatusLine>}
      <Scorecard view={v} options={turn.options} onScore={(category) => turn.score(category)} />
      <p role="status" className="sr-only">
        {over
          ? t("final", { count: score })
          : dice !== null
            ? t("announce.roll", { number: v.rolls, dice: dice.join(", ") })
            : v.last
              ? t("announce.scored", { points: v.last.points, box: t(`box.${v.last.category}`) })
              : ""}
      </p>
    </div>
  );
}
