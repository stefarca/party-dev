// How often an open match page sends the raw "ping" keepalive, and how long
// the Durable Object goes on counting a socket as someone watching after its
// last one. Shared so the two cannot drift apart: a window shorter than the
// interval would read every live page as gone between two pings, and the
// player sitting in front of the board would be nudged about it.
//
// Its own module for the same reason as shared/history.ts: the client needs
// these at runtime, and importing a value from shared/protocol.ts would pull
// its zod schemas into the browser bundle.
export const HEARTBEAT_INTERVAL_MS = 25_000;

// Two missed pings, and half an interval of slack for a slow network.
export const PRESENCE_WINDOW_MS = HEARTBEAT_INTERVAL_MS * 2.5;
