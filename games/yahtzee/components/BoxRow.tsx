import { useTranslation } from "react-i18next";

import { LINE, POINTS } from "../lines";

// One box of the card. While the dice may be scored in it, it is a button
// showing what they would score there; otherwise it shows what it scored, or
// nothing yet. The box scored last is lit until the next one is.
export function BoxRow({
  name,
  scored,
  preview,
  latest,
  onScore,
}: {
  name: string;
  scored: number | undefined;
  preview: number | null;
  latest: boolean;
  onScore: () => void;
}) {
  const { t } = useTranslation("yahtzee");
  if (preview !== null) {
    return (
      <li>
        <button
          type="button"
          aria-label={t("card.choose", { points: preview, box: name })}
          onClick={onScore}
          className={`${LINE} cursor-pointer border-dashed border-[var(--border-accent)] bg-[var(--accent-soft)] transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] touch-manipulation hover:scale-[1.03] active:scale-95`}
        >
          <span className="truncate font-semibold text-[var(--text-primary)]">{name}</span>
          <span
            className={`${POINTS} ${preview === 0 ? "text-[var(--text-muted)]" : "text-[var(--accent-on-soft)]"}`}
          >
            {preview}
          </span>
        </button>
      </li>
    );
  }
  const filled = scored !== undefined;
  return (
    <li
      className={`${LINE} ${
        latest
          ? "animate-[party-choice-press_var(--dur-slow)_var(--ease-spring)] border-[var(--ok-border)] bg-[var(--ok-soft)]"
          : filled
            ? "border-transparent bg-[var(--surface-2)]"
            : "border-[var(--border-subtle)]"
      }`}
    >
      <span
        className={`truncate ${filled ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"}`}
      >
        {name}
      </span>{" "}
      {filled ? (
        <span className={`${POINTS} text-[var(--text-primary)]`}>{scored}</span>
      ) : (
        <span className="sr-only">{t("card.open")}</span>
      )}
    </li>
  );
}
