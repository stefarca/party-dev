// Deterministic, content-free decoration derived from an id string.
//
// Nothing here knows a game id or a player id by name: every game and every
// player gets its look from a hash of its own id, so registering a new game
// or a new nickname needs no change in this file (and no per-game asset).
// Colour is never the only signal anywhere it is used — each call site pairs
// it with a glyph, an initial, or a label.

function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export type SeatIndex = 1 | 2 | 3 | 4;

const SEATS: SeatIndex[] = [1, 2, 3, 4];

// The four-colour seat ramp from the stylesheet. Used both for real game
// seats (where the index comes from the game) and for avatars (where it
// comes from this hash).
export function seatFill(seat: SeatIndex): string {
  return `var(--seat-${seat})`;
}

export function seatInk(seat: SeatIndex): string {
  return `var(--seat-${seat}-contrast)`;
}

export function seatForId(id: string): SeatIndex {
  return SEATS[hash(id) % SEATS.length];
}

// The decorative motif on a game tile. Six abstract shapes, picked by hash —
// enough variety that two registered games rarely collide, and meaningless
// if they do (the game's name is always shown next to it).
export type GameMotif = "dots" | "grid" | "bolt" | "star" | "rings" | "wave";

const MOTIFS: GameMotif[] = ["dots", "grid", "bolt", "star", "rings", "wave"];

export function motifForId(id: string): GameMotif {
  return MOTIFS[hash(id) % MOTIFS.length];
}

// A pair of party hues for a game tile's gradient, again chosen by hash.
const TILE_PAIRS: [string, string][] = [
  ["var(--accent)", "var(--party-pink)"],
  ["var(--party-pink)", "var(--party-warm)"],
  ["var(--party-mint)", "var(--accent)"],
  ["var(--party-warm)", "var(--seat-1)"],
  ["var(--seat-2)", "var(--party-mint)"],
  ["var(--accent)", "var(--seat-2)"],
];

export function tileGradient(id: string): string {
  const [from, to] = TILE_PAIRS[(hash(id) >>> 3) % TILE_PAIRS.length];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

// First grapheme-ish character of a nickname, uppercased, for an avatar
// fallback. Falls back to a bullet so an all-emoji or empty nickname still
// renders something centred.
export function initialFor(nickname: string): string {
  const trimmed = nickname.trim();
  if (trimmed.length === 0) return "•";
  return [...trimmed][0].toUpperCase();
}
