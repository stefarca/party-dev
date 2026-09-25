import { COLORS } from "./game";

export const PALETTE = Array.from({ length: COLORS }, (_, color) => color);

// Each colour's name key. Type-checked against the English file.
export const NAME = [
  "color.0",
  "color.1",
  "color.2",
  "color.3",
  "color.4",
  "color.5",
  "color.6",
] as const;
