import type { MatchEvent } from "../../shared/protocol";

// A generic, collapsible view of the event log. Newest first,
// and deliberately ignorant of any game's payload shape — `payload` is
// rendered as raw JSON, whatever it is.

export function HistoryPanel({ events }: { events: MatchEvent[] }) {
  const newestFirst = [...events].reverse();

  return (
    <details className="panel history-panel">
      <summary className="history-summary">
        History
        <span className="chip">{events.length}</span>
      </summary>
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
