import type { ReactNode } from "react";

// The look every list on the hub shares, the day's games and a player's
// matches alike. On a phone the rows sit in one grouped card, each divided
// from the one above it by a line inset past its badge; from `sm` up each row
// is a card of its own in a two-column grid.

export function HubList({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border-2 border-[var(--border-subtle)] bg-[var(--surface-1)] shadow-[var(--shadow-2),var(--edge-highlight)] sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent sm:shadow-none">
      {children}
    </div>
  );
}

// A row's outer element, usually its link: the badge sits in it directly, and
// everything to the badge's right goes in `hubRowBody`.
export const HUB_ROW =
  "party-pop group flex items-stretch gap-3 pl-4 no-underline transition-[transform,box-shadow,border-color,background-color] duration-[var(--dur-base)] ease-[var(--ease-spring)] hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)] sm:rounded-[var(--radius-xl)] sm:border-2 sm:border-[var(--border-subtle)] sm:bg-[var(--surface-1)] sm:py-4 sm:shadow-[var(--shadow-2),var(--edge-highlight)] sm:hover:-translate-y-1 sm:hover:border-[var(--border-accent)] sm:hover:bg-[var(--surface-1)] sm:hover:shadow-[var(--shadow-3),var(--glow-accent)] sm:active:translate-y-0";

// The badge of a row: centred on however many lines its text takes.
export const HUB_ROW_BADGE =
  "size-10 self-center transition-transform duration-[var(--dur-base)] ease-[var(--ease-bounce)] group-hover:-rotate-12 group-hover:scale-110 sm:size-12";

// Everything right of a row's badge. `divided` draws the line between this
// row and the one above it, which only a phone's grouped card has.
export function hubRowBody(divided: boolean): string {
  return `flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-4 sm:py-0 ${
    divided ? "max-sm:border-t max-sm:border-[var(--border-subtle)]" : ""
  }`;
}

// The pill on the right of a row that says what opening it does, like
// playing or joining. `strong` is for the one thing the player should do
// next; the rest take the soft accent.
export function HubRowAction({ strong, children }: { strong: boolean; children: ReactNode }) {
  return (
    <span
      className="flex-none rounded-[var(--radius-pill)] px-3.5 py-1.5 text-sm font-bold transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] group-hover:scale-105"
      style={
        strong
          ? { background: "var(--accent)", color: "var(--text-on-accent)" }
          : { background: "var(--accent-soft)", color: "var(--accent-on-soft)" }
      }
    >
      {children}
    </span>
  );
}
