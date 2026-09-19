// Bumped whenever shared/protocol.ts message shapes change in a
// backwards-incompatible way. Version 2 introduced the live-match wire
// protocol (hello/action/start/ping, snapshot/events/error/pong,
// MatchSnapshot). Version 3 closed the event log's payload: an `action`
// event now carries the game's own description of the move instead of its
// raw action, so a client older than this renders nothing for one.
export const PROTOCOL_VERSION = 3;
