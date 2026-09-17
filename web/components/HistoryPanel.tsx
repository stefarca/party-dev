import { Chip, Disclosure } from "@heroui/react";

import type { MatchEvent } from "../../shared/protocol";

// A generic, collapsible view of the event log. Newest first,
// and deliberately ignorant of any game's payload shape — `payload` is
// rendered as raw JSON, whatever it is. Collapsed by default (react-aria's
// own uncontrolled disclosure state, not anything MatchPage passes down) so
// mounting a fresh event never re-opens or re-collapses it.

export function HistoryPanel({ events }: { events: MatchEvent[] }) {
  const newestFirst = [...events].reverse();

  return (
    <Disclosure className="mb-4 overflow-hidden rounded-lg border border-border bg-surface shadow-[var(--edge-highlight),var(--shadow-2)]">
      <Disclosure.Heading>
        <Disclosure.Trigger className="flex w-full items-center gap-2 px-4 py-3 text-left font-semibold text-foreground">
          History
          <Chip size="sm">{events.length}</Chip>
          <Disclosure.Indicator />
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body>
          {newestFirst.length === 0 ? (
            <p className="m-0 text-muted">No moves yet.</p>
          ) : (
            <ul className="m-0 flex max-h-64 list-none flex-col gap-2 overflow-y-auto">
              {newestFirst.map((event) => (
                <li key={event.seq}>
                  <div className="flex justify-between text-xs text-muted">
                    <span>#{event.seq}</span>
                    <span>{new Date(event.ts).toLocaleTimeString()}</span>
                  </div>
                  <pre className="mt-1 overflow-x-auto rounded-sm bg-[var(--surface-inset)] p-2 text-sm shadow-[var(--shadow-inset)]">
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
