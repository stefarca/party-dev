import type { ConnectionState } from "../useMatch";

// Small always-visible indicator so a stalled socket is visible rather than
// mysterious — the page keeps working over HTTP either way, but the player
// should be able to tell why live updates stopped.

const LABEL: Record<ConnectionState, string> = {
  connecting: "Connecting…",
  live: "Live",
  offline: "Reconnecting…",
};

// Short form for the phone-width header, where the full sentence would wrap
// the row. The accessible name below always uses the full label.
const SHORT: Record<ConnectionState, string> = {
  connecting: "…",
  live: "Live",
  offline: "Off",
};

const TONE: Record<ConnectionState, string> = {
  connecting: "var(--warn-fg)",
  live: "var(--ok-fg)",
  offline: "var(--danger-fg)",
};

export function ConnectionBadge({ connection }: { connection: ConnectionState }) {
  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={LABEL[connection]}
      title={LABEL[connection]}
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-bold"
      style={{ color: TONE[connection] }}
    >
      <span
        aria-hidden="true"
        className={`size-2 flex-none rounded-full ${connection === "live" ? "animate-pulse" : ""}`}
        style={{ background: TONE[connection] }}
      />
      <span aria-hidden="true" className="hidden sm:inline">
        {LABEL[connection]}
      </span>
      <span aria-hidden="true" className="sm:hidden">
        {SHORT[connection]}
      </span>
    </span>
  );
}
