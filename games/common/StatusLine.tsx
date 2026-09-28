import type { ReactNode } from "react";

// The one line under a board that says where the game stands: whose turn it
// is, or how it ended. `danger` is for an ending the player caused.
export function StatusLine({
  children,
  tone = "plain",
}: {
  children: ReactNode;
  tone?: "plain" | "danger";
}) {
  return (
    <p
      className={`m-0 text-center text-sm font-semibold ${
        tone === "danger" ? "text-[var(--danger-fg)]" : "text-[var(--text-secondary)]"
      }`}
    >
      {children}
    </p>
  );
}
