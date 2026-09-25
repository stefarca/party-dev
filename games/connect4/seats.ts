// Colour is never the only signal for whose disc is whose: each seat also
// gets a distinct glyph (rendered inside the disc) and an aria-label, for
// the colour-blind coworker in the office.
export const SEAT_COLOR: Record<0 | 1, string> = { 0: "var(--seat-1)", 1: "var(--seat-2)" };
export const SEAT_CONTRAST: Record<0 | 1, string> = {
  0: "var(--seat-1-contrast)",
  1: "var(--seat-2-contrast)",
};
export const SEAT_GLYPH: Record<0 | 1, string> = { 0: "✕", 1: "●" };

// The glossy sheen every filled disc carries, built from the palette's
// `--gloss-*` tokens rather than a hardcoded white.
export const GLOSS =
  "radial-gradient(circle at 34% 28%, var(--gloss-highlight), var(--gloss-fade) 56%)";
