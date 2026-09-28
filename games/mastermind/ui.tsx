import { useTranslation } from "react-i18next";

import type { DailyUiProps } from "../../shared/protocol";
import { Banner } from "../common/Banner";
import { clock } from "../common/clock";
import { closest, isForTheBoard, useWindowKeys } from "../common/keyboard";
import { Loading } from "../common/Loading";
import { Stats } from "../common/Stats";
import { StatusLine } from "../common/StatusLine";
import { useNow } from "../common/useNow";
import { Board } from "./components/Board";
import { MarksLegend } from "./components/MarksLegend";
import { Tray } from "./components/Tray";
import { MAX_GUESSES } from "./game";
import type { MastermindView } from "./game";
import type strings from "./locales/en.json";
import { useDraft } from "./useDraft";

declare module "i18next" {
  interface ResourceNamespaceMap {
    mastermind: typeof strings;
  }
}

// The Mastermind board: seven rows of five holes, one per guess, each with
// its marks beside it, and a palette of the seven colours below. A player
// fills the current row from the palette, then checks it; the row shows the
// guess as the server marked it once the move lands.
//
// Every colour is also a symbol, so no peg is told apart by colour alone, and
// the marks are a filled peg and a hollow ring, told apart by shape. Each
// row's accessible name spells both out.

// Enter on a focused button presses that button, and must not check as well.
const PRESSES_ENTER = "button, a, [role='button']";

export default function MastermindUi({ view, status, send }: DailyUiProps) {
  const { t, i18n } = useTranslation("mastermind");
  const v = view as MastermindView | null;
  const solved = v?.solvedAt != null;
  const outOfGuesses = !solved && (v?.guesses.length ?? 0) >= MAX_GUESSES;
  const playable = status === "active" && v !== null && !solved && !outOfGuesses;
  const now = useNow(playable);
  const language = i18n.resolvedLanguage ?? "en";
  const draft = useDraft(view, playable, send);

  // A colour picked by its number anywhere on the page goes into the current row.
  useWindowKeys(playable, (event) => {
    if (!isForTheBoard(event)) return;
    if (/^[1-7]$/.test(event.key)) draft.pick(Number(event.key) - 1);
    else if (event.key === "Backspace" || event.key === "Delete") draft.erase();
    else if (event.key === "Enter" && !closest(event, PRESSES_ENTER)) draft.check();
    else return;
    event.preventDefault();
  });

  if (!v) return <Loading label={t("loading")} />;

  const count = new Intl.NumberFormat(language);
  const elapsed =
    v.solvedAt !== null
      ? v.solvedAt - v.startedAt
      : status === "active"
        ? Math.max(0, now - v.startedAt)
        : null;
  const stats: [key: "guesses" | "time", value: string][] = [
    ["guesses", `${count.format(v.guesses.length)}/${count.format(MAX_GUESSES)}`],
    ["time", elapsed !== null ? clock(elapsed) : "–"],
  ];

  const last = v.guesses.at(-1);
  const current = v.guesses.length;
  const message = solved
    ? null
    : outOfGuesses
      ? t("failed")
      : status === "done"
        ? t("ended")
        : current === 0
          ? t("hint")
          : null;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 sm:max-w-lg">
      <Stats
        label={t("stats.label")}
        stats={stats.map(([key, value]) => ({ key, label: t(`stats.${key}`), value }))}
      />

      {/* The tray sits beside the board from `sm` up, so it is on the screen with the board;
          below it on a phone. */}
      <div className="flex w-full flex-col items-center gap-4 sm:flex-row sm:items-start sm:justify-center">
        <Board view={v} playable={playable} draft={draft} />
        <Tray draft={draft} />
      </div>

      <MarksLegend />

      {solved && (
        <Banner fill="var(--tile-32)" celebrate>
          {t("solved", { count: current })}
        </Banner>
      )}
      {message && <StatusLine>{message}</StatusLine>}
      <p role="status" className="sr-only">
        {solved
          ? t("solved", { count: current })
          : last
            ? t("announce", {
                number: current,
                marks: t("marks", { exact: last.exact, near: last.near }),
              })
            : ""}
      </p>
    </div>
  );
}
