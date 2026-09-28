// A, B, C, D … next to each choice, so a pick can be named out loud and read
// out by a screen reader without depending on position or colour.
const CHOICE_LETTERS = "ABCDEFGH";

// `fill` and `ink` travel together: `--text-on-accent` only reads on the
// saturated status fills, so the neutral (unpicked) badge has to carry its
// own ink rather than inheriting the one the accent badge uses.
export const NEUTRAL_BADGE = { fill: "var(--surface-3)", ink: "var(--text-secondary)" };
export const ACCENT_BADGE = { fill: "var(--accent)", ink: "var(--text-on-accent)" };
export const OK_BADGE = { fill: "var(--ok-fg)", ink: "var(--text-on-accent)" };
export const DANGER_BADGE = { fill: "var(--danger-fg)", ink: "var(--text-on-accent)" };

export function ChoiceLetter({
  index,
  badge,
}: {
  index: number;
  badge: { fill: string; ink: string };
}) {
  return (
    <span
      aria-hidden="true"
      className="flex size-7 flex-none items-center justify-center rounded-[var(--radius-xs)] font-display text-sm font-bold"
      style={{ background: badge.fill, color: badge.ink }}
    >
      {CHOICE_LETTERS[index] ?? index + 1}
    </span>
  );
}
