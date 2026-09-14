import type { ConnectionState } from "../useMatch";

// Small always-visible indicator so a stalled socket is visible rather than
// mysterious — the page keeps working over HTTP either way,
// but the player should be able to tell why live updates stopped.

const LABEL: Record<ConnectionState, string> = {
  connecting: "Connecting…",
  live: "Live",
  offline: "Offline — reconnecting…",
};

export function ConnectionBadge({ connection }: { connection: ConnectionState }) {
  return <span className={`connection-badge connection-${connection}`}>{LABEL[connection]}</span>;
}
