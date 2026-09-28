import { useRef } from "react";

import { CELL_BOX, cellStyle } from "../cells";
import { CELLS } from "../game";
import type { Direction, G2048View } from "../game";
import { Tile, shownTiles } from "./Tile";

// How far a pointer has to travel, in CSS pixels, before it counts as a swipe.
const SWIPE_MIN_PX = 24;

// The board: its empty cells, the tiles over them, and a swipe across it
// in any of the four directions. Decoration for a screen reader, which reads
// `TileTable` instead.
export function Board({
  view: v,
  playable,
  onMove,
}: {
  view: G2048View;
  playable: boolean;
  onMove: (dir: Direction) => void;
}) {
  const swipe = useRef<{ pointer: number; x: number; y: number } | null>(null);
  return (
    <div className="@container w-full">
      <div
        aria-hidden="true"
        className="relative aspect-square w-full touch-none rounded-[var(--radius-lg)] border-4 p-[1.5cqw] shadow-[var(--shadow-inset),var(--shadow-2)] select-none"
        style={{ background: "var(--board-well)", borderColor: "var(--board-rim)" }}
        onPointerDown={(event) => {
          if (playable)
            swipe.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          const start = swipe.current;
          swipe.current = null;
          if (!start || start.pointer !== event.pointerId) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_PX) return;
          if (Math.abs(dx) > Math.abs(dy)) onMove(dx > 0 ? "right" : "left");
          else onMove(dy > 0 ? "down" : "up");
        }}
        onPointerCancel={() => {
          swipe.current = null;
        }}
      >
        <div className="relative size-full">
          {Array.from({ length: CELLS }, (_, cell) => (
            <div key={cell} className={CELL_BOX} style={cellStyle(cell)}>
              <div className="size-full rounded-[var(--radius-sm)] bg-[var(--board-hole)] shadow-[var(--shadow-inset)]" />
            </div>
          ))}
          {shownTiles(v).map((tile) => (
            <Tile key={tile.id} tile={tile} />
          ))}
        </div>
      </div>
    </div>
  );
}
