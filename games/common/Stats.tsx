// The row of figures above a daily board: score, time, moves and the like.
// Labels arrive already worded in the game's own namespace, since a shared
// component has none of its own.
export interface Stat {
  key: string;
  label: string;
  value: string;
}

// Written out in full: Tailwind only emits class names it can read in the source.
const COLUMNS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

export function Stats({ label, stats }: { label: string; stats: Stat[] }) {
  // Four to a row leaves each cell narrow, so they give up some padding.
  const pad = stats.length >= 4 ? "px-1" : "px-2";
  return (
    <dl aria-label={label} className={`m-0 grid w-full gap-2 ${COLUMNS[stats.length] ?? ""}`}>
      {stats.map((stat) => (
        <div
          key={stat.key}
          className={`flex flex-col items-center rounded-[var(--radius-md)] bg-[var(--surface-2)] ${pad} py-2 shadow-[var(--edge-highlight)]`}
        >
          <dt className="sr-only">{stat.label}</dt>
          {/* The word and the value share one element, with a real space between them, so
              the cell reads as "Moves 12" to a test as well as to the eye. */}
          <dd className="m-0 flex flex-col items-center gap-0.5">
            <span
              aria-hidden="true"
              className="text-[0.65rem] font-bold tracking-[0.12em] text-[var(--text-muted)] uppercase"
            >
              {stat.label}
            </span>{" "}
            <span className="font-display text-xl font-bold text-[var(--text-primary)] tabular-nums sm:text-2xl">
              {stat.value}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
