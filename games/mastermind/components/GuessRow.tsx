import { useTranslation } from "react-i18next";

import { NAME } from "../colors";
import { PEGS } from "../game";
import type { Guess } from "../game";
import { HOLES, NUMBER, ROW } from "../rows";
import { Marks } from "./Marks";
import { Peg } from "./Peg";

// A guess the server has marked. The row is its name: its pegs and marks
// are drawn, and hidden from assistive technology. A cracked code lights
// its row up; the newest guess pops its pegs in.
export function GuessRow({
  guess,
  index,
  latest,
}: {
  guess: Guess;
  index: number;
  latest: boolean;
}) {
  const { t } = useTranslation("mastermind");
  return (
    <li
      aria-label={t("guess", {
        number: index + 1,
        pegs: guess.pegs.map((color) => t(NAME[color])).join(", "),
        marks: t("marks", { exact: guess.exact, near: guess.near }),
      })}
      className={ROW}
      style={
        guess.exact === PEGS
          ? { background: "color-mix(in oklab, var(--board-mark) 45%, transparent)" }
          : undefined
      }
    >
      <span aria-hidden="true" className={NUMBER}>
        {index + 1}
      </span>
      <span aria-hidden="true" className={HOLES}>
        {guess.pegs.map((color, slot) => (
          <span key={slot} className="aspect-square">
            <Peg color={color} pop={latest} />
          </span>
        ))}
      </span>
      <Marks guess={guess} />
    </li>
  );
}
