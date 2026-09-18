import { Disclosure } from "@heroui/react";

import type { MatchEvent } from "../../shared/protocol";

// A generic, collapsible view of the event log. Newest first, and
// deliberately ignorant of any game's payload shape — `payload` is rendered
// as raw JSON, whatever it is. Collapsed by default (react-aria's own
// uncontrolled disclosure state, not anything MatchPage passes down) so
// mounting a fresh event never re-opens or re-collapses it.

export function HistoryPanel({ events }: { events: MatchEvent[] }) {
  const newestFirst = [...events].reverse();

  return (
    <Disclosure className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-surface/70 shadow-[var(--edge-highlight),var(--shadow-1)]">
      <Disclosure.Heading>
        <Disclosure.Trigger className="flex w-full items-center gap-2 px-5 py-3 text-left font-display text-sm font-semibold text-[var(--text-secondary)]">
          History
          <span className="inline-flex min-w-6 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--surface-3)] px-2 py-0.5 text-xs font-bold text-[var(--text-muted)]">
            {events.length}
          </span>
          <Disclosure.Indicator />
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="px-5 pb-4">
          {newestFirst.length === 0 ? (
            <p className="m-0 text-sm text-[var(--text-muted)]">No moves yet.</p>
          ) : (
            <ul className="m-0 flex max-h-64 list-none flex-col gap-2 overflow-y-auto p-0">
              {newestFirst.map((event) => (
                <li key={event.seq}>
                  <div className="flex justify-between text-xs text-[var(--text-muted)]">
                    <span>#{event.seq}</span>
                    <span>{new Date(event.ts).toLocaleTimeString()}</span>
                  </div>
                  <pre className="mt-1 overflow-x-auto rounded-[var(--radius-xs)] bg-[var(--surface-inset)] p-2 font-mono text-xs shadow-[var(--shadow-inset)]">
                    {JSON.stringify(event.payload)}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  );
}
