import { useTranslation } from "react-i18next";

import type { Hole } from "../game";
import { Legend } from "./Legend";

// What the course's markings mean, for the hazards this hole has. Hidden
// from assistive technology, which hears the hole's hazards in the course's
// own name. `ids` is the prefix the course's fills were defined under.
export function HazardLegend({ hole, ids }: { hole: Hole; ids: string }) {
  const { t } = useTranslation("minigolf");
  const ice = hole.ice ?? [];
  const springs = hole.springs ?? [];
  const tunnels = hole.tunnels ?? [];
  const hazards = [hole.water, hole.sand, ice, hole.slopes, hole.blocks, springs, tunnels];
  if (hazards.every((areas) => areas.length === 0)) return null;
  return (
    <div
      aria-hidden="true"
      className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs font-semibold text-[var(--text-secondary)]"
    >
      {hole.water.length > 0 && <Legend fill={`url(#${ids}-water)`}>{t("legend.water")}</Legend>}
      {hole.sand.length > 0 && <Legend fill={`url(#${ids}-sand)`}>{t("legend.sand")}</Legend>}
      {ice.length > 0 && <Legend fill={`url(#${ids}-ice)`}>{t("legend.ice")}</Legend>}
      {springs.length > 0 && (
        <Legend fill={`url(#${ids}-spring)`} back="var(--golf-spring)">
          {t("legend.spring")}
        </Legend>
      )}
      {tunnels.length > 0 && (
        <Legend fill={`url(#${ids}-tunnel)`} back="var(--golf-green)">
          {t("legend.tunnel")}
        </Legend>
      )}
      {hole.slopes.length > 0 && (
        <Legend fill={`url(#${ids}-slope-0)`} back="var(--golf-green)">
          {t("legend.slope")}
        </Legend>
      )}
    </div>
  );
}
