import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { DailyUiProps } from "../../shared/protocol";
import { Banner } from "../common/Banner";
import { clock } from "../common/clock";
import { Loading } from "../common/Loading";
import { ModeToggle } from "../common/ModeToggle";
import { Stats } from "../common/Stats";
import { StatusLine } from "../common/StatusLine";
import { useNow } from "../common/useNow";
import { FlagGlyph } from "./components/FlagGlyph";
import { Minefield } from "./components/Minefield";
import { MINES, NEIGHBOURS } from "./game";
import type { MinesweeperAction, MinesweeperView } from "./game";
import type strings from "./locales/en.json";

declare module "i18next" {
  interface ResourceNamespaceMap {
    minesweeper: typeof strings;
  }
}

// The minefield: a 10×12 grid of squares and a flag switch. A tap opens a
// square, and a tap on a number whose mines are all flagged opens the rest
// around it. A long press, a right-click or the switch plants a flag. Every
// move goes to the server, which alone knows where the mines are, so a square
// opens once its move lands.
//
// The grid is an ARIA grid with one tab stop, the selected square, and the
// arrow keys move it; Space or Enter opens the square and F flags it. Each
// square's accessible name says what it shows, since a number's colour and a
// flag's shape are nothing to a screen reader.

export default function MinesweeperUi({ view, status, send }: DailyUiProps) {
  const { t, i18n } = useTranslation("minesweeper");
  const v = view as MinesweeperView | null;
  const over = v !== null && (v.clearedAt !== null || v.blast !== null);
  const playable = status === "active" && v !== null && !over;
  const now = useNow(playable);
  const language = i18n.resolvedLanguage ?? "en";
  const [flagMode, setFlagMode] = useState(false);

  if (!v) return <Loading label={t("loading")} />;

  const squares = v.squares;
  const flags = squares.filter((square) => square === "flag").length;
  // The clear squares still shut: every square not yet open, less the mines.
  const left = squares.filter((square) => typeof square !== "number").length - MINES;

  const move = (action: MinesweeperAction) => {
    if (playable) send(action);
  };
  // A tap: dig, or flag in flag mode; on a number whose mines are all
  // flagged, open the rest around it.
  const open = (cell: number) => {
    const square = squares[cell];
    if (square === "hidden") {
      move(flagMode ? { t: "flag", cell, on: true } : { t: "reveal", cell });
    } else if (square === "flag") {
      if (flagMode) move({ t: "flag", cell, on: false });
    } else if (typeof square === "number" && square > 0) {
      const around = NEIGHBOURS[cell];
      const flagged = around.filter((other) => squares[other] === "flag").length;
      const shut = around.some((other) => squares[other] === "hidden");
      if (flagged === square && shut) move({ t: "chord", cell });
    }
  };
  const toggleFlag = (cell: number) => {
    const square = squares[cell];
    if (square === "hidden" || square === "flag") {
      move({ t: "flag", cell, on: square === "hidden" });
    }
  };

  const count = new Intl.NumberFormat(language);
  const elapsed =
    v.clearedAt !== null
      ? v.clearedAt - v.startedAt
      : v.blast !== null
        ? v.blast.at - v.startedAt
        : status === "active"
          ? Math.max(0, now - v.startedAt)
          : null;
  const stats: [key: "time" | "mines" | "moves", value: string][] = [
    ["time", elapsed !== null ? clock(elapsed) : "–"],
    ["mines", count.format(MINES - flags)],
    ["moves", count.format(v.moves)],
  ];

  const message =
    v.clearedAt !== null
      ? null
      : v.blast !== null
        ? t("blast")
        : status === "done"
          ? t("ended")
          : v.moves === 0
            ? t("hint")
            : null;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4">
      <Stats
        label={t("stats.label")}
        stats={stats.map(([key, value]) => ({ key, label: t(`stats.${key}`), value }))}
      />
      <Minefield view={v} playable={playable} onOpen={open} onFlag={toggleFlag} />
      <ModeToggle
        pressed={flagMode}
        disabled={!playable}
        onToggle={() => setFlagMode((on) => !on)}
        icon={<FlagGlyph className="size-5" />}
        label={t("flag.mode")}
        on={t("flag.on")}
        off={t("flag.off")}
      />
      {v.clearedAt !== null && elapsed !== null && (
        <Banner fill="var(--tile-32)" celebrate>
          {t("cleared", { time: clock(elapsed) })}
        </Banner>
      )}
      {message && <StatusLine tone={v.blast !== null ? "danger" : "plain"}>{message}</StatusLine>}
      <p role="status" className="sr-only">
        {v.clearedAt !== null && elapsed !== null
          ? t("cleared", { time: clock(elapsed) })
          : v.blast !== null
            ? t("blast")
            : t("announce", { count: left })}
      </p>
    </div>
  );
}
