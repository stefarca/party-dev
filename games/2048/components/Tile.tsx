import { CELL_BOX, cellStyle } from "../cells";
import { GOAL } from "../game";
import type { G2048View } from "../game";

// Written out in full: Tailwind only emits class names it can read in the source.
const TILE_FILL: Record<number, string> = {
  2: "var(--tile-2)",
  4: "var(--tile-4)",
  8: "var(--tile-8)",
  16: "var(--tile-16)",
  32: "var(--tile-32)",
  64: "var(--tile-64)",
  128: "var(--tile-128)",
  256: "var(--tile-256)",
  512: "var(--tile-512)",
  1024: "var(--tile-1024)",
  2048: "var(--tile-2048)",
};

const GLOSS = "linear-gradient(to bottom, var(--gloss-highlight), var(--gloss-fade) 55%)";

// A tile's number in hundredths of the board's width, so it fits its tile on
// a phone and on a desktop alike.
function fontSize(value: number): string {
  const digits = String(value).length;
  if (digits <= 2) return "11cqw";
  if (digits === 3) return "9cqw";
  if (digits === 4) return "7cqw";
  return "5.5cqw";
}

// The face's animation, which plays when the face mounts: a spawned tile
// grows in and a merged one swells, both once the slide has had time to land.
const FACE_MOTION = {
  spawned: "animate-[party-tile-spawn_var(--dur-base)_var(--ease-spring)_var(--dur-fast)_both]",
  merged: "animate-[party-tile-merge_var(--dur-base)_var(--ease-spring)_var(--dur-fast)_both]",
  none: "",
} as const;

export interface ShownTile {
  id: number;
  value: number;
  cell: number;
  // Merged away this move: drawn beneath the tile it merged into, sliding
  // there, and gone after the next move.
  absorbed: boolean;
  motion: keyof typeof FACE_MOTION;
}

export function shownTiles(v: G2048View): ShownTile[] {
  const merged = new Set(v.last?.merged ?? []);
  const tiles: ShownTile[] = v.tiles.map((tile) => ({
    ...tile,
    absorbed: false,
    motion: tile.id === v.last?.spawned ? "spawned" : merged.has(tile.id) ? "merged" : "none",
  }));
  for (const tile of v.last?.absorbed ?? []) {
    tiles.push({ ...tile, absorbed: true, motion: "none" });
  }
  // In id order, which is also the order they were first drawn in, so React
  // only ever appends and removes elements, never moves one — a moved element
  // would jump to its new cell instead of sliding.
  return tiles.sort((a, b) => a.id - b.id);
}

export function Tile({ tile }: { tile: ShownTile }) {
  const big = tile.value >= GOAL;
  return (
    <div
      className={`${CELL_BOX} transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] ${
        tile.absorbed ? "z-0" : "z-10"
      }`}
      style={cellStyle(tile.cell)}
    >
      {/* Keyed by value, so a merge mounts a fresh face and its animation plays. */}
      <div
        key={tile.value}
        className={`flex size-full items-center justify-center rounded-[var(--radius-sm)] font-display leading-none font-bold tabular-nums ${
          big
            ? "shadow-[var(--game-piece-shadow),0_0_1.4rem_var(--tile-2048)]"
            : "shadow-[var(--game-piece-shadow)]"
        } ${FACE_MOTION[tile.motion]}`}
        style={{
          backgroundColor: TILE_FILL[tile.value] ?? "var(--tile-super)",
          backgroundImage: GLOSS,
          color: "var(--tile-ink)",
          fontSize: fontSize(tile.value),
        }}
      >
        {tile.value}
      </div>
    </div>
  );
}
