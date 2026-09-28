import { useTranslation } from "react-i18next";

import { FLEET } from "../game";
import type { ShipId } from "../game";

// The fleet listed under a board, with every sunk ship struck through.
export function Roster({ sunk }: { sunk: ShipId[] }) {
  const { t } = useTranslation("battleship");
  return (
    <ul className="m-0 flex list-none flex-wrap justify-center gap-1.5 p-0">
      {FLEET.map(({ id, length }) => {
        const down = sunk.includes(id);
        return (
          <li
            key={id}
            className={`flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-[var(--surface-1)] px-2 py-0.5 text-xs ${
              down ? "text-[var(--text-muted)] line-through" : "text-[var(--text-secondary)]"
            }`}
          >
            <span aria-hidden="true" className="flex gap-px">
              {Array.from({ length }, (_, i) => (
                <span
                  key={i}
                  className={`size-1.5 rounded-full ${down ? "bg-[var(--seat-1)]" : "bg-[var(--text-muted)]"}`}
                />
              ))}
            </span>
            {t(`ship.${id}`)}
            {down && <span className="sr-only">, {t("cell.sunk")}</span>}
          </li>
        );
      })}
    </ul>
  );
}
