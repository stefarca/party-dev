import { useTranslation } from "react-i18next";

import type { Direction } from "../game";

const PAD: { dir: Direction; arrow: string }[] = [
  { dir: "left", arrow: "←" },
  { dir: "up", arrow: "↑" },
  { dir: "down", arrow: "↓" },
  { dir: "right", arrow: "→" },
];

// Four arrow buttons under the board, for a player with neither keys nor a
// swipe to hand.
export function Pad({ disabled, onMove }: { disabled: boolean; onMove: (dir: Direction) => void }) {
  const { t } = useTranslation("2048");
  return (
    <div role="group" aria-label={t("controls")} className="flex gap-2">
      {PAD.map(({ dir, arrow }) => (
        <button
          key={dir}
          type="button"
          aria-label={t(`move.${dir}`)}
          disabled={disabled}
          onClick={() => onMove(dir)}
          className="flex size-11 cursor-pointer items-center justify-center rounded-[var(--radius-pill)] border border-[var(--border-subtle)] bg-[var(--surface-2)] font-display text-lg font-bold text-[var(--text-secondary)] shadow-[var(--edge-highlight)] transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] not-disabled:hover:scale-105 not-disabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden="true">{arrow}</span>
        </button>
      ))}
    </div>
  );
}
