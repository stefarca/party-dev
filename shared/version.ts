// Bumped whenever shared/protocol.ts message shapes change in a
// backwards-incompatible way. Version 2 introduced the live-match wire
// protocol (hello/action/start/ping, snapshot/events/error/pong,
// MatchSnapshot).
export const PROTOCOL_VERSION = 2;
