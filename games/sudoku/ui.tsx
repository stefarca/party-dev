import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { DailyUiProps } from "../../shared/protocol";
import { Banner } from "../common/Banner";
import { BUTTON, PLAIN } from "../common/buttons";
import { clock } from "../common/clock";
import { isForTheBoard, useWindowKeys } from "../common/keyboard";
import { Loading } from "../common/Loading";
import { ModeToggle } from "../common/ModeToggle";
import { Stats } from "../common/Stats";
import { StatusLine } from "../common/StatusLine";
import { useNow } from "../common/useNow";
import { ARROWS, moveFrom } from "./arrows";
import { DigitPad } from "./components/DigitPad";
import { Grid } from "./components/Grid";
import { clashes, valuesOf } from "./game";
import type { SudokuView } from "./game";
import type strings from "./locales/en.json";

declare module "i18next" {
  interface ResourceNamespaceMap {
    sudoku: typeof strings;
  }
}

// The sudoku board: a 9×9 grid of squares, a pad of the nine digits, and a
// notes switch. A player picks a square, then a digit, and every entry goes
// to the server; the board shows the run as the server last returned it, so
// a digit appears once its move lands.
//
// The grid is an ARIA grid with one tab stop, the selected square, and the
// arrow keys move it. Each square's accessible name says what is in it,
// whether it was given, and whether it clashes, since those are drawn in
// colour and weight a screen reader cannot see.

const ERASE_KEYS = new Set(["Backspace", "Delete", "0"]);

export default function SudokuUi({ view, status, send }: DailyUiProps) {
  const { t, i18n } = useTranslation("sudoku");
  const v = view as SudokuView | null;
  const solved = v?.solvedAt != null;
  const playable = status === "active" && v !== null && !solved;
  const now = useNow(playable);
  const language = i18n.resolvedLanguage ?? "en";

  const [selected, setSelected] = useState<number | null>(null);
  const [notesMode, setNotesMode] = useState(false);

  const open = v !== null && selected !== null && v.givens[selected] === 0;
  const canErase = playable && open && (v.entries[selected] !== 0 || v.notes[selected] !== 0);
  const enter = (digit: number) => {
    if (!playable || !open) return;
    if (notesMode) {
      if (v.entries[selected] === 0) send({ t: "note", cell: selected, digit });
    } else {
      send({ t: "set", cell: selected, digit });
    }
  };
  const erase = () => {
    if (canErase) send({ t: "clear", cell: selected });
  };
  const toggleNotes = () => {
    if (playable) setNotesMode((on) => !on);
  };

  // A digit typed anywhere on the page goes into the selected square, the
  // way a sudoku board behaves.
  useWindowKeys(playable, (event) => {
    if (!isForTheBoard(event)) return;
    const arrow = ARROWS[event.key];
    if (/^[1-9]$/.test(event.key)) enter(Number(event.key));
    else if (ERASE_KEYS.has(event.key)) erase();
    else if (event.key === "n" || event.key === "N") toggleNotes();
    // Arrows pressed inside the grid are the grid's own; these are the ones
    // pressed with focus elsewhere, on the pad say.
    else if (arrow) setSelected(moveFrom(selected, arrow));
    else return;
    event.preventDefault();
  });

  if (!v) return <Loading label={t("loading")} />;

  const values = valuesOf(v);
  const clash = clashes(values);
  const canEnter = playable && open && !(notesMode && v.entries[selected] !== 0);
  const left = values.filter((digit) => digit === 0).length;
  const anyClash = clash.some(Boolean);

  const count = new Intl.NumberFormat(language);
  const elapsed =
    v.solvedAt !== null
      ? v.solvedAt - v.startedAt
      : status === "active"
        ? Math.max(0, now - v.startedAt)
        : null;
  const stats: [key: "time" | "left" | "moves", value: string][] = [
    ["time", elapsed !== null ? clock(elapsed) : "–"],
    ["left", count.format(left)],
    ["moves", count.format(v.moves)],
  ];

  const message = solved
    ? null
    : status === "done"
      ? t("ended")
      : left === 0 && anyClash
        ? t("full")
        : v.moves === 0
          ? t("hint")
          : null;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4">
      <Stats
        label={t("stats.label")}
        stats={stats.map(([key, value]) => ({ key, label: t(`stats.${key}`), value }))}
      />
      <Grid
        view={v}
        values={values}
        clash={clash}
        selected={selected}
        playable={playable}
        onSelect={setSelected}
      />
      <DigitPad values={values} notesMode={notesMode} disabled={!canEnter} onEnter={enter} />
      <div className="flex gap-2">
        <ModeToggle
          pressed={notesMode}
          disabled={!playable}
          onToggle={toggleNotes}
          icon={<span aria-hidden="true">✎</span>}
          label={t("pad.notes")}
          on={t("pad.on")}
          off={t("pad.off")}
        />
        <button
          type="button"
          disabled={!canErase}
          onClick={erase}
          className={`${BUTTON} ${PLAIN} h-11 gap-2 rounded-[var(--radius-pill)] px-4 text-sm font-bold`}
        >
          <span aria-hidden="true">⌫</span>
          {t("pad.erase")}
        </button>
      </div>

      {solved && elapsed !== null && (
        <Banner fill="var(--tile-32)" celebrate>
          {t("solved", { time: clock(elapsed) })}
        </Banner>
      )}
      {message && <StatusLine>{message}</StatusLine>}
      <p role="status" className="sr-only">
        {solved && elapsed !== null
          ? t("solved", { time: clock(elapsed) })
          : `${t("announce", { count: left })}${anyClash ? ` ${t("announceClash")}` : ""}`}
      </p>
    </div>
  );
}
