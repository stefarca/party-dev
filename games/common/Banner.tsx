import type { ReactNode } from "react";

// A pill announcing what a run just did, on one of the tile colours (`fill`,
// a CSS colour). A `celebrate`d one bounces twice as it appears.
export function Banner({
  children,
  fill,
  celebrate = false,
}: {
  children: ReactNode;
  fill: string;
  celebrate?: boolean;
}) {
  return (
    <p
      className={`m-0 rounded-[var(--radius-pill)] px-4 py-1.5 text-center text-sm font-bold text-[var(--tile-ink)] ${
        celebrate ? "animate-[party-celebrate_var(--dur-slow)_var(--ease-bounce)_2]" : ""
      }`}
      style={{ background: fill }}
    >
      {children}
    </p>
  );
}
