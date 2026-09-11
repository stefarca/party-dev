// Bumped whenever shared/protocol.ts message shapes change in a
// backwards-incompatible way. Plan 01 only needed a pure value to exist so
// the test harness had something real to check. Plan 04 introduces the
// actual live-match wire protocol (hello/action/start/ping,
// snapshot/events/error/pong, MatchSnapshot) — bumped from 1 to 2.
export const PROTOCOL_VERSION = 2;
