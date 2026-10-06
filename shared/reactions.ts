// The reactions a player can send in a match. A fixed set rather than free
// text, so there is nothing to moderate, and each has a name in every
// language (`reactions.<id>` in web/locales/) for screen readers. The wire
// carries the id; the emoji is only how the client draws it.
//
// Its own module rather than part of shared/protocol.ts, like
// shared/history.ts: the client needs these values at runtime, and importing
// any value from protocol.ts pulls its zod schemas into the browser bundle.
export const REACTIONS = ["clap", "laugh", "wow", "grr", "fire", "turtle", "gg", "skull"] as const;
export type Reaction = (typeof REACTIONS)[number];

export const REACTION_EMOJI: Record<Reaction, string> = {
  clap: "👏",
  laugh: "😂",
  wow: "😮",
  grr: "😤",
  fire: "🔥",
  turtle: "🐢",
  gg: "🤝",
  skull: "💀",
};

// How many of a match's latest reactions its snapshot carries, the client
// keeps, and the match stores at all: they are banter, not a record.
export const REACTION_LIMIT = 30;

// The least time between two reactions from one player in one match. The
// client holds its buttons back for as long, so only a client that does not
// is ever refused.
export const REACTION_COOLDOWN_MS = 1500;
