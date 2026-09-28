import { useTranslation } from "react-i18next";

import type { DailyUiProps } from "../../shared/protocol";
import { Banner } from "../common/Banner";
import { clock } from "../common/clock";
import { Loading } from "../common/Loading";
import { Stats } from "../common/Stats";
import { StatusLine } from "../common/StatusLine";
import { useNow } from "../common/useNow";
import { LightGrid } from "./components/LightGrid";
import { litCount } from "./game";
import type { LightsOutView } from "./game";
import type strings from "./locales/en.json";

declare module "i18next" {
  interface ResourceNamespaceMap {
    lightsout: typeof strings;
  }
}

// The Lights Out board: a 5×5 grid of lights, the day's par above it. A tap
// presses a light, and every press goes to the server; the board shows the
// run as the server last returned it, so a light flips once its press lands.
//
// The grid is an ARIA grid with one tab stop, the selected light, and the
// arrow keys move it; Space or Enter presses it. Each light's accessible name
// says whether it is on, since that is drawn in colour and glow.

export default function LightsOutUi({ view, status, send }: DailyUiProps) {
  const { t, i18n } = useTranslation("lightsout");
  const v = view as LightsOutView | null;
  const solved = v?.solvedAt != null;
  const playable = status === "active" && v !== null && !solved;
  const now = useNow(playable);
  const language = i18n.resolvedLanguage ?? "en";

  if (!v) return <Loading label={t("loading")} />;

  const pressLight = (cell: number) => {
    if (playable) send({ t: "press", cell });
  };
  const lit = litCount(v.lights);
  const count = new Intl.NumberFormat(language);
  const elapsed =
    v.solvedAt !== null
      ? v.solvedAt - v.startedAt
      : status === "active"
        ? Math.max(0, now - v.startedAt)
        : null;
  const stats: [key: "presses" | "par" | "time", value: string][] = [
    ["presses", count.format(v.presses)],
    ["par", count.format(v.par)],
    ["time", elapsed !== null ? clock(elapsed) : "–"],
  ];

  const overPar = v.presses - v.par;
  const message = solved
    ? overPar === 0
      ? t("atPar")
      : t("overPar", { count: overPar })
    : status === "done"
      ? t("ended")
      : v.presses === 0
        ? t("hint")
        : null;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4">
      <Stats
        label={t("stats.label")}
        stats={stats.map(([key, value]) => ({ key, label: t(`stats.${key}`), value }))}
      />
      <LightGrid lights={v.lights} playable={playable} onPress={pressLight} />
      {solved && (
        <Banner fill="var(--tile-128)" celebrate>
          {t("solved", { count: v.presses })}
        </Banner>
      )}
      {message && <StatusLine>{message}</StatusLine>}
      <p role="status" className="sr-only">
        {solved ? t("solved", { count: v.presses }) : t("announce", { count: lit })}
      </p>
    </div>
  );
}
