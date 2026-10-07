import { useState } from "react";

import { useTranslation } from "react-i18next";

import { getAchievement } from "../../shared/achievements";
import type { AchievementProgress } from "../../shared/protocol";
import { useLanguage } from "../i18n";

// Every achievement, earned or not, in catalog order: what it asks for next and how far along
// the player is, or when they finished it. Its level shows as one dot per tier. Something
// reached in the last week is marked new, whether or not it was announced.

const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

function LevelDots({ level, total }: { level: number; total: number }) {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={t("achievements.level", { level, total })}
      className="ml-auto flex flex-none gap-1"
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`size-2 rounded-full ${i < level ? "bg-[var(--warn-fg)]" : "bg-[var(--surface-3)]"}`}
        />
      ))}
    </span>
  );
}

function AchievementItem({ progress, now }: { progress: AchievementProgress; now: number }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const achievement = getAchievement(progress.id);
  if (!achievement) return null;

  const { tiers } = achievement;
  const level = Math.min(progress.unlockedAt.length, tiers.length);
  const complete = level === tiers.length;
  // The goal on show: the next tier's, or the last one's once every tier is reached.
  const goal = tiers[complete ? tiers.length - 1 : level];
  const latest = progress.unlockedAt[level - 1];
  const recent = latest !== undefined && now - latest < RECENT_MS;

  let tone = "border-dashed border-[var(--border-subtle)] bg-[var(--surface-2)]";
  if (complete) tone = "border-[var(--warn-border)] bg-[var(--warn-soft)]";
  else if (level > 0) tone = "border-[var(--border-subtle)] bg-[var(--surface-2)]";

  return (
    <li className={`flex min-w-0 gap-3 rounded-[var(--radius-lg)] border-2 p-3 ${tone}`}>
      <span
        aria-hidden="true"
        className={`flex size-12 flex-none items-center justify-center rounded-full bg-[var(--surface-1)] text-2xl ${
          level === 0 ? "opacity-50 grayscale" : ""
        }`}
      >
        {achievement.glyph}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <h3 className="m-0 min-w-0 text-sm font-bold text-[var(--text-primary)]">
            {t(`achievements.items.${progress.id}.name`)}
          </h3>
          {recent && (
            <span
              className="flex-none rounded-[var(--radius-pill)] px-1.5 py-px text-[0.65rem] font-bold"
              style={{ background: "var(--party-pink-soft)", color: "var(--party-pink-on-soft)" }}
            >
              {t("achievements.new")}
            </span>
          )}
          {tiers.length > 1 && <LevelDots level={level} total={tiers.length} />}
        </div>
        <p className="m-0 text-xs text-[var(--text-secondary)]">
          {t(`achievements.items.${progress.id}.goal`, { count: goal })}
        </p>
        {complete ? (
          <p className="m-0 text-xs text-[var(--text-muted)]">
            {t("achievements.unlocked", {
              date: new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(latest),
            })}
          </p>
        ) : (
          goal > 1 && (
            <div className="flex items-center gap-2">
              {/* The same numbers as the words beside it, drawn. */}
              <div
                aria-hidden="true"
                className="h-1.5 flex-1 overflow-hidden rounded-[var(--radius-pill)] bg-[var(--surface-3)]"
              >
                <div
                  className="h-full rounded-[var(--radius-pill)] bg-[var(--accent)]"
                  style={{ width: `${(Math.min(progress.value, goal) / goal) * 100}%` }}
                />
              </div>
              <span className="flex-none text-xs text-[var(--text-muted)] tabular-nums">
                {t("achievements.progress", { value: Math.min(progress.value, goal), goal })}
              </span>
            </div>
          )
        )}
      </div>
    </li>
  );
}

export function AchievementList({ achievements }: { achievements: AchievementProgress[] }) {
  const { t } = useTranslation();
  // Fixed for the life of the list, so what counts as new does not shift between renders.
  const [now] = useState(() => Date.now());
  return (
    <ul
      aria-label={t("achievements.label")}
      className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2"
    >
      {achievements.map((progress) => (
        <AchievementItem key={progress.id} progress={progress} now={now} />
      ))}
    </ul>
  );
}

// How many levels of how many the player has reached, over every achievement.
export function levelsReached(achievements: AchievementProgress[]): {
  unlocked: number;
  total: number;
} {
  let unlocked = 0;
  let total = 0;
  for (const progress of achievements) {
    const tiers = getAchievement(progress.id)?.tiers.length ?? 0;
    unlocked += Math.min(progress.unlockedAt.length, tiers);
    total += tiers;
  }
  return { unlocked, total };
}
