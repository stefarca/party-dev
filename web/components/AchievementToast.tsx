import { useEffect, useState } from "react";

import { Button } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { getAchievement } from "../../shared/achievements";
import type { Unlock } from "../achievements";
import { navigate } from "../router";
import { Confetti } from "./Confetti";

// "Achievement unlocked!", over whatever page the player is on, with a burst of confetti. Lists
// the newest few by name and goal, and links to the rest on the stats page.
//
// It closes itself after a while, since it arrives unasked and can sit over a board, but never
// while the pointer or the focus is on it.

const LISTED = 3;
const AUTO_CLOSE_MS = 10_000;

export const ACHIEVEMENTS_ANCHOR = "achievements";

export function AchievementToast({ unlocks, onClose }: { unlocks: Unlock[]; onClose: () => void }) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = unlocks.length > 0;

  useEffect(() => {
    if (!open || hovered || focused) return;
    const timer = setTimeout(onClose, AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open, unlocks, hovered, focused, onClose]);

  if (!open) return null;

  const listed = unlocks.slice(0, LISTED);
  const more = unlocks.length - listed.length;

  function seeAll() {
    onClose();
    navigate(`/stats#${ACHIEVEMENTS_ANCHOR}`);
    // Already on the stats page, nothing mounts to scroll there itself.
    requestAnimationFrame(() =>
      document.getElementById(ACHIEVEMENTS_ANCHOR)?.scrollIntoView({ behavior: "smooth" }),
    );
  }

  // Under the header, so it covers neither the hub's tab bar nor the update prompt; centred on a
  // phone and on the right from `sm` up.
  return (
    <>
      <Confetti fire />
      <div
        role="status"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
        }}
        className="fixed top-[calc(4.5rem+env(safe-area-inset-top))] left-1/2 z-50 flex w-[min(24rem,calc(100%-2rem))] -translate-x-1/2 animate-in flex-col gap-3 rounded-[var(--radius-lg)] border-2 border-[var(--warn-border)] bg-[var(--surface-2)] p-4 shadow-[var(--shadow-3)] duration-300 fade-in slide-in-from-top-4 sm:right-4 sm:left-auto sm:translate-x-0"
      >
        <p className="m-0 font-display text-base font-bold text-[var(--text-primary)]">
          <span aria-hidden="true">🏅 </span>
          {t("achievements.toast.title", { count: unlocks.length })}
        </p>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {listed.map(({ id, level }) => {
            const achievement = getAchievement(id);
            if (!achievement) return null;
            return (
              <li key={id} className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-10 flex-none items-center justify-center rounded-full bg-[var(--warn-soft)] text-xl"
                >
                  {achievement.glyph}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-bold text-[var(--text-primary)]">
                    {t(`achievements.items.${id}.name`)}
                  </span>{" "}
                  <span className="text-xs text-[var(--text-secondary)]">
                    {t(`achievements.items.${id}.goal`, { count: achievement.tiers[level - 1] })}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        {more > 0 && (
          <p className="m-0 text-xs text-[var(--text-muted)]">
            {t("achievements.toast.more", { count: more })}
          </p>
        )}
        <div className="flex gap-2">
          <Button size="sm" onPress={seeAll}>
            {t("achievements.toast.seeAll")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onPress={onClose}>
            {t("achievements.toast.close")}
          </Button>
        </div>
      </div>
    </>
  );
}
