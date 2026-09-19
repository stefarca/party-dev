// The most events any one history request returns, and the most the client
// keeps. Shared so the two cannot drift apart: a client that kept fewer
// than the server sends would throw away rows it just asked for.
//
// Its own module rather than a line in shared/protocol.ts: the client needs
// this value at runtime, and importing any value from protocol.ts runs its
// zod schema definitions, pulling them into the browser bundle for nothing.
export const HISTORY_LIMIT = 200;
