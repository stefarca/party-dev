// The achievements a player can earn, in the order the stats page shows them. Each one measures
// one thing the match index already records — wins, finished matches, play days, daily runs —
// and has one or more tiers: the values of that measure at which it is reached, smallest first.
// Its level is how many tiers the player has reached, so an achievement with one tier is simply
// earned or not.
//
// Every tier is a fixed number rather than "every game" or "the whole catalog": a tier a player
// has reached must stay reached when a game is added. And every measure only ever grows, so an
// achievement once earned is never lost, a reset of the record included.
//
// Its own module rather than part of shared/protocol.ts, like shared/reactions.ts: the client
// needs these values at runtime. Names and goals are `achievements.items.<id>` in web/locales/;
// the glyph is only how the client draws one.
export const ACHIEVEMENTS = [
  // Matches won.
  { id: "winner", glyph: "🏆", tiers: [1, 10, 50] },
  // The longest run of finished matches won in a row.
  { id: "hotStreak", glyph: "⚡", tiers: [3, 5, 10] },
  // Matches finished.
  { id: "veteran", glyph: "🎖️", tiers: [10, 50, 200] },
  // The longest play streak: UTC days in a row with a move or a daily run.
  { id: "regular", glyph: "🔥", tiers: [3, 7, 30] },
  // Different games finished, matches and daily games alike.
  { id: "explorer", glyph: "🧭", tiers: [3, 6, 10] },
  // Different players finished a match against.
  { id: "social", glyph: "🦋", tiers: [2, 5, 10] },
  // The most matches finished against any one player.
  { id: "rivalry", glyph: "⚔️", tiers: [5, 20, 50] },
  // Matches hosted that got under way.
  { id: "host", glyph: "🎪", tiers: [3, 10, 50] },
  // Public matches hosted that got under way.
  { id: "openHouse", glyph: "📣", tiers: [1] },
  // Matches finished in a draw.
  { id: "stalemate", glyph: "🤝", tiers: [1] },
  // Moves made 20 hours or more after the match turned to the player.
  { id: "slowpoke", glyph: "🐌", tiers: [1] },
  // Daily runs finished.
  { id: "dailyHabit", glyph: "☀️", tiers: [5, 25, 100] },
  // The most different daily games finished on one day.
  { id: "cleanSweep", glyph: "🧹", tiers: [3, 7] },
  // Days on top of a daily game's final chart, with someone else ranked on it.
  { id: "topOfTheChart", glyph: "👑", tiers: [1, 5, 20] },
] as const satisfies readonly { id: string; glyph: string; tiers: readonly number[] }[];

export type Achievement = (typeof ACHIEVEMENTS)[number];
export type AchievementId = Achievement["id"];

export const ACHIEVEMENT_IDS = ACHIEVEMENTS.map((a) => a.id) as AchievementId[];

export function getAchievement(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

// The time a move has to keep a match waiting for `slowpoke`, which web/locales/ state in words.
// Short of the games' 24-hour turn clock: a turn left that long is played for whoever let it run
// out, and that move is not theirs.
export const SLOWPOKE_MS = 20 * 60 * 60 * 1000;

// How many players a daily chart needs, ranked, before topping it counts.
export const TOP_OF_THE_CHART_MIN_RANKED = 2;
