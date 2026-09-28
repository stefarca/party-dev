import { useTranslation } from "react-i18next";

import { cellName } from "../game";
import type { BattleshipView, Seat } from "../game";

// What just happened and what happens next, read out as it changes: the
// last shot in bold, then whose shot it is, which is left out once the
// match is `over`.
export function Report({
  view: v,
  seat,
  over,
  nameOf,
}: {
  view: BattleshipView;
  seat: Seat | null;
  over: boolean;
  nameOf: (seat: Seat) => string;
}) {
  const { t } = useTranslation("battleship");
  const lines: string[] = [];
  if (v.lastShot) {
    const { by, cell, hit, sunk } = v.lastShot;
    const values = {
      cell: cellName(cell),
      name: nameOf(by),
      ship: sunk ? t(`theShip.${sunk}`) : "",
    };
    const who = by === seat ? "you" : "they";
    const outcome = sunk ? "Sunk" : hit ? "Hit" : "Miss";
    lines.push(t(`lastShot.${who}${outcome}`, values));
  }
  if (!over) {
    if (v.phase === "placing") {
      const theirs: Seat = seat === 0 ? 1 : 0;
      lines.push(seat === null ? t("status.placing") : t("status.ready", { name: nameOf(theirs) }));
    } else if (v.yourTurn) {
      lines.push(t("status.yourShot"));
    } else if (v.turn !== null) {
      lines.push(t("status.waitingShot", { name: nameOf(v.turn) }));
    }
  }

  return (
    <div role="status" className="flex flex-col items-center gap-0.5 text-center">
      {lines.map((line, i) => (
        <p
          key={line}
          className={`m-0 text-sm ${
            i === 0 && v.lastShot
              ? "font-bold text-[var(--text-primary)]"
              : "font-semibold text-[var(--text-secondary)]"
          }`}
        >
          {line}
        </p>
      ))}
    </div>
  );
}
