import { useTranslation } from "react-i18next";

import type { DailyUiProps } from "../../shared/protocol";
import { Banner } from "../common/Banner";
import { isForTheBoard, useWindowKeys } from "../common/keyboard";
import { Loading } from "../common/Loading";
import { Stats } from "../common/Stats";
import { StatusLine } from "../common/StatusLine";
import { Board } from "./components/Board";
import { Pad } from "./components/Pad";
import { TileTable } from "./components/TileTable";
import { GOAL } from "./game";
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

// Arrow keys (and WASD) work wherever focus is, the way every 2048 board
// behaves.
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

export default function G2048Ui({ view, status, send }: DailyUiProps) {
  const { t, i18n } = useTranslation("2048");
  const v = view as G2048View | null;
  const playable = status === "active" && v !== null && !v.over;
  const language = i18n.resolvedLanguage ?? "en";

  useWindowKeys(playable, (event) => {
    const dir = KEYS[event.key];
    // Shift is left alone: nothing on this board is typed with it.
    if (!dir || event.shiftKey || !isForTheBoard(event)) return;
    // Handled even when held down, so the page does not scroll instead.
    event.preventDefault();
    if (event.repeat) return;
    send({ t: "move", dir });
  });

  if (!v) return <Loading label={t("loading")} />;

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
      <Stats
        label={t("stats.label")}
        stats={stats.map(([key, value]) => ({
          key,
          label: t(`stats.${key}`),
          value: count.format(value),
        }))}
      />
      <Board view={v} playable={playable} onMove={move} />
      <TileTable view={v} />
      <Pad disabled={!playable} onMove={move} />
      {reachedGoal && (
        <Banner fill="var(--tile-2048)" celebrate>
          {t("goal")}
        </Banner>
      )}
      <StatusLine>
        {v.over ? t("over") : status === "done" ? t("ended") : v.moves === 0 ? t("hint") : null}
      </StatusLine>
      <p role="status" className="sr-only">
        {t("announce", { score: count.format(v.score), best: v.best })}
      </p>
    </div>
  );
}
