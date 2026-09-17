import { Chip, type ChipProps } from "@heroui/react";
import type { ConnectionState } from "../useMatch";

// Small always-visible indicator so a stalled socket is visible rather than
// mysterious — the page keeps working over HTTP either way,
// but the player should be able to tell why live updates stopped.

const LABEL: Record<ConnectionState, string> = {
  connecting: "Connecting…",
  live: "Live",
  offline: "Offline — reconnecting…",
};

const COLOR: Record<ConnectionState, ChipProps["color"]> = {
  connecting: "warning",
  live: "success",
  offline: "danger",
};

const DOT_COLOR: Record<ConnectionState, string> = {
  connecting: "bg-warning",
  live: "bg-success",
  offline: "bg-danger",
};

export function ConnectionBadge({ connection }: { connection: ConnectionState }) {
  return (
    <Chip color={COLOR[connection]} variant="soft" size="sm" role="status" aria-live="polite">
      <span
        className={`mr-1 h-2 w-2 flex-none rounded-full ${DOT_COLOR[connection]}`}
        aria-hidden="true"
      />
      <Chip.Label>{LABEL[connection]}</Chip.Label>
    </Chip>
  );
}
