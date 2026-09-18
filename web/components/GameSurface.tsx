import type { ReactNode } from "react";

// The "arcade cabinet" every game's UI is mounted into: a bezel strip
// showing the game's name (and an optional status slot) above a recessed
// playfield well. Strictly presentational — it never inspects `view`,
// `players`, `result`, or any game id; everything it shows is passed in by
// the caller.
export function GameSurface({
  title,
  status,
  children,
}: {
  title: string;
  children: ReactNode;
  status?: ReactNode;
}) {
  return (
    <section className="party-pop overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--surface-1)] shadow-[var(--shadow-3),var(--edge-highlight)]">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-2)] px-5 py-3">
        {/* Small and quiet on purpose: the page already carries the game's
            name as its heading, so this is the cabinet's bezel label rather
            than a second title competing with it. */}
        <h2 className="m-0 font-display text-xs font-bold tracking-[0.15em] text-[var(--text-muted)] uppercase">
          {title}
        </h2>
        {status !== undefined && (
          <span className="text-xs font-semibold text-[var(--text-muted)]">{status}</span>
        )}
      </header>
      <div className="bg-[var(--surface-inset)] p-3 shadow-[var(--shadow-inset)] sm:p-5">
        {children}
      </div>
    </section>
  );
}
