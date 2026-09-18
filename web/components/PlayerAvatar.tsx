import { initialFor, seatForId, seatFill, seatInk } from "../identity";

const SIZE = {
  sm: "size-7 text-xs",
  md: "size-9 text-sm",
  lg: "size-12 text-lg",
} as const;

// A player's initial on a deterministic seat colour. The ring is drawn with
// `--border-subtle` rather than the fill so the avatar's outline is visible
// on every surface regardless of which of the four seat colours it drew —
// the fill itself never has to carry the shape.
export function PlayerAvatar({
  nickname,
  id,
  size = "md",
  className = "",
}: {
  nickname: string;
  id: string;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const seat = seatForId(id);
  return (
    <span
      aria-hidden="true"
      className={`inline-flex flex-none items-center justify-center rounded-full font-display font-bold ring-2 ring-[var(--border-subtle)] ${SIZE[size]} ${className}`}
      style={{
        background: seatFill(seat),
        color: seatInk(seat),
        boxShadow: "var(--shadow-1), var(--edge-highlight)",
      }}
    >
      {initialFor(nickname)}
    </span>
  );
}

// An "open seat" placeholder matching PlayerAvatar's footprint.
export function EmptyAvatar({ size = "md" }: { size?: keyof typeof SIZE }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex flex-none items-center justify-center rounded-full border-2 border-dashed border-[var(--border-strong)] font-display text-[var(--text-muted)] ${SIZE[size]}`}
    >
      +
    </span>
  );
}
