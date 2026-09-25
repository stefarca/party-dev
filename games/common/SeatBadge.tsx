import type { ReactNode } from "react";

// A player's pill above a two-player board: their token, their name, and
// anything else the game counts for them. The pill lifts and takes the
// accent while it is that player's turn. `label` arrives already worded in
// the game's own namespace (a shared component has none of its own), so a
// game passes "You (name)" for the player at this device.
export function SeatBadge({
  token,
  label,
  isYou,
  isTurn,
  children,
}: {
  token: ReactNode;
  label: string;
  isYou: boolean;
  isTurn: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-[var(--radius-pill)] border-2 px-3 py-1.5 transition-[transform,border-color] duration-[var(--dur-base)] ease-[var(--ease-spring)] ${
        isTurn ? "scale-105 border-[var(--border-accent)]" : "border-transparent"
      }`}
      style={{ background: isTurn ? "var(--accent-soft)" : "var(--surface-1)" }}
    >
      {token}
      <span
        className={`truncate text-sm ${isYou ? "font-bold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}
      >
        {label}
      </span>
      {children}
    </div>
  );
}
