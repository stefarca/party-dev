import { useId } from "react";
import type { ReactNode } from "react";

// One half of the card under its heading: its boxes, then what it adds up.
export function CardSection({ title, children }: { title: string; children: ReactNode }) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className="flex min-w-0 flex-col gap-1.5">
      <h3
        id={heading}
        className="m-0 px-1 text-[0.65rem] font-bold tracking-[0.12em] text-[var(--text-muted)] uppercase"
      >
        {title}
      </h3>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">{children}</ul>
    </section>
  );
}
