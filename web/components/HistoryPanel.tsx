import type { MatchEvent } from "../../shared/protocol";

// A generic, collapsible view of the event log (PLAN.md §7). Newest first,
// and deliberately ignorant of any game's payload shape — `payload` is
// rendered as raw JSON, whatever it is.

export function HistoryPanel({ events }: { events: MatchEvent[] }) {
  const newestFirst = [...events].reverse();

  return (
    <details className="card history-panel">
      <summary>History ({events.length})</summary>
      <ul className="history-list">
        {newestFirst.map((event) => (
          <li key={event.seq} className="history-item">
            <div className="history-item-head">
              <span className="history-seq">#{event.seq}</span>
              <span className="history-ts">{new Date(event.ts).toLocaleTimeString()}</span>
            </div>
            <pre className="history-payload">{JSON.stringify(event.payload)}</pre>
          </li>
        ))}
      </ul>
    </details>
  );
}
