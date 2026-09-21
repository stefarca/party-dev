import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import type { DailyUiProps } from "../../shared/protocol";
import { CELLS, GOAL, SIZE } from "./game";
import type { Direction, G2048View } from "./game";
import type strings from "./locales/en.json";

declare module "i18next" {
  interface ResourceNamespaceMap {
    "2048": typeof strings;
  }
}

// The 2048 board. Tiles are absolutely positioned and keyed by id, so a tile
// that moves keeps its element and slides there on a CSS transition; a tile
// that merged swells once it lands, and a new one grows in after the slide.
// Every move goes to the server — the next tile comes from a PRNG this page
// never sees — and the page posts them in order, so this board sends a move
// for every key, swipe or button press and lets the server ignore the ones
// that turn out to be blocked.
//
// The board itself is decoration for a screen reader, which reads the same
// tiles from a visually hidden table instead.

// The one listener that has to live on the window: arrow keys work wherever
// focus is, the way every 2048 board behaves. Reached through a narrow type of
// its own rather than `window`, since the Worker's type-check of this file has
// no DOM types to offer.
interface KeyLike {
  key: string;
  repeat: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
  target: unknown;
  preventDefault(): void;
}

interface KeyTarget {
  addEventListener(type: "keydown", listener: (event: KeyLike) => void): void;
  removeEventListener(type: "keydown", listener: (event: KeyLike) => void): void;
}

const KEYS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
};

// Keys typed into a field, or pressed inside a dialog, are someone else's.
const NOT_FOR_THE_BOARD =
  "input, textarea, select, [contenteditable], [role='dialog'], [role='alertdialog']";

function isForTheBoard(event: KeyLike): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false;
  if (event.shiftKey) return false;
  const target = event.target as { closest?: (selector: string) => unknown } | null;
  return !target?.closest?.(NOT_FOR_THE_BOARD);
}

const PAD: { dir: Direction; arrow: string }[] = [
  { dir: "left", arrow: "←" },
  { dir: "up", arrow: "↑" },
  { dir: "down", arrow: "↓" },
  { dir: "right", arrow: "→" },
];

// How far a pointer has to travel, in CSS pixels, before it counts as a swipe.
const SWIPE_MIN_PX = 24;

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

// One cell's box inside the board: a quarter of it each way, moved into place
// by whole cells so that the move itself can be what animates.
function cellStyle(cell: number): CSSProperties {
  const row = Math.floor(cell / SIZE);
  const col = cell % SIZE;
  return { transform: `translate(${col * 100}%, ${row * 100}%)` };
}

const CELL_BOX = "absolute top-0 left-0 h-1/4 w-1/4 p-[1.5cqw]";

// The face's animation, which plays when the face mounts: a spawned tile
// grows in and a merged one swells, both once the slide has had time to land.
const FACE_MOTION = {
  spawned: "animate-[party-tile-spawn_var(--dur-base)_var(--ease-spring)_var(--dur-fast)_both]",
  merged: "animate-[party-tile-merge_var(--dur-base)_var(--ease-spring)_var(--dur-fast)_both]",
  none: "",
} as const;

interface ShownTile {
  id: number;
  value: number;
  cell: number;
  // Merged away this move: drawn beneath the tile it merged into, sliding
  // there, and gone after the next move.
  absorbed: boolean;
  motion: keyof typeof FACE_MOTION;
}

function shownTiles(v: G2048View): ShownTile[] {
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

function Tile({ tile }: { tile: ShownTile }) {
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

export default function G2048Ui({ view, status, send }: DailyUiProps) {
  const { t, i18n } = useTranslation("2048");
  const v = view as G2048View | null;
  const playable = status === "active" && v !== null && !v.over;
  const language = i18n.resolvedLanguage ?? "en";

  // The key listener outlives renders; this keeps it posting through the
  // page's current `send`.
  const sendRef = useRef(send);
  sendRef.current = send;
  const swipe = useRef<{ pointer: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!playable) return;
    const target = globalThis as unknown as KeyTarget;
    function onKey(event: KeyLike) {
      const dir = KEYS[event.key];
      if (!dir || !isForTheBoard(event)) return;
      // Handled even when held down, so the page does not scroll instead.
      event.preventDefault();
      if (event.repeat) return;
      sendRef.current({ t: "move", dir });
    }
    target.addEventListener("keydown", onKey);
    return () => target.removeEventListener("keydown", onKey);
  }, [playable]);

  if (!v) {
    return <p className="m-0 text-[var(--text-muted)]">{t("loading")}</p>;
  }

  const move = (dir: Direction) => {
    if (playable) send({ t: "move", dir });
  };
  const count = new Intl.NumberFormat(language);
  const reachedGoal = (v.last?.merged ?? []).some(
    (id) => v.tiles.find((tile) => tile.id === id)?.value === GOAL,
  );
  const stats: [key: "score" | "best" | "moves", value: number][] = [
    ["score", v.score],
    ["best", v.best],
    ["moves", v.moves],
  ];

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4">
      <dl aria-label={t("stats.label")} className="m-0 grid w-full grid-cols-3 gap-2">
        {stats.map(([key, value]) => (
          <div
            key={key}
            className="flex flex-col items-center rounded-[var(--radius-md)] bg-[var(--surface-2)] px-2 py-2 shadow-[var(--edge-highlight)]"
          >
            <dt className="sr-only">{t(`stats.${key}`)}</dt>
            {/* The word and the number share one element, with a real space between them, so
                the cell reads as "Moves 12" to a test as well as to the eye. */}
            <dd className="m-0 flex flex-col items-center gap-0.5">
              <span
                aria-hidden="true"
                className="text-[0.65rem] font-bold tracking-[0.12em] text-[var(--text-muted)] uppercase"
              >
                {t(`stats.${key}`)}
              </span>{" "}
              <span className="font-display text-xl font-bold text-[var(--text-primary)] tabular-nums sm:text-2xl">
                {count.format(value)}
              </span>
            </dd>
          </div>
        ))}
      </dl>

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
            if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? "right" : "left");
            else move(dy > 0 ? "down" : "up");
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

      <table className="sr-only">
        <caption>{t("board")}</caption>
        <tbody>
          {Array.from({ length: SIZE }, (_, row) => (
            <tr key={row}>
              {Array.from({ length: SIZE }, (_, col) => {
                const tile = v.tiles.find((candidate) => candidate.cell === row * SIZE + col);
                return <td key={col}>{tile ? tile.value : t("empty")}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div role="group" aria-label={t("controls")} className="flex gap-2">
        {PAD.map(({ dir, arrow }) => (
          <button
            key={dir}
            type="button"
            aria-label={t(`move.${dir}`)}
            disabled={!playable}
            onClick={() => move(dir)}
            className="flex size-11 cursor-pointer items-center justify-center rounded-[var(--radius-pill)] border border-[var(--border-subtle)] bg-[var(--surface-2)] font-display text-lg font-bold text-[var(--text-secondary)] shadow-[var(--edge-highlight)] transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] not-disabled:hover:scale-105 not-disabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden="true">{arrow}</span>
          </button>
        ))}
      </div>

      {reachedGoal && (
        <p className="m-0 animate-[party-celebrate_var(--dur-slow)_var(--ease-bounce)_2] rounded-[var(--radius-pill)] px-4 py-1.5 text-sm font-bold text-[var(--tile-ink)] [background:var(--tile-2048)]">
          {t("goal")}
        </p>
      )}
      <p className="m-0 text-center text-sm font-semibold text-[var(--text-secondary)]">
        {v.over ? t("over") : status === "done" ? t("ended") : v.moves === 0 ? t("hint") : null}
      </p>
      <p role="status" className="sr-only">
        {t("announce", { score: count.format(v.score), best: v.best })}
      </p>
    </div>
  );
}
