import type { TFunction } from "i18next";

import type { GameMeta } from "../games/catalog";

// Small display-only formatting helpers. Pure: each takes the language to format in (or `t`)
// rather than reading it. Times and units go through `Intl`, so they need no strings of their own
// in the locale files.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// How far `epochMs` is from `now`, in the largest unit that fits: "5s ago", "in 3m", "2 h fa".
export function relativeTime(language: string, epochMs: number, now: number = Date.now()): string {
  const diffMs = epochMs - now;
  if (Math.abs(diffMs) < 5 * SECOND) {
    return new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(0, "second");
  }
  const format = new Intl.RelativeTimeFormat(language, { style: "narrow" });
  // Each unit is rounded from the one below it, so 90 seconds reads as 2 minutes.
  const seconds = Math.round(diffMs / SECOND);
  if (Math.abs(seconds) < 60) return format.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return format.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return format.format(hours, "hour");
  return format.format(Math.round(hours / 24), "day");
}

// A duration in at most four characters ("2d", "3h", "4:05", "9s"), for a countdown ring that
// cannot fit more. Resolution tightens as the time runs down.
export function shortDuration(language: string, ms: number): string {
  const unit = (value: number, name: "day" | "hour" | "second") =>
    new Intl.NumberFormat(language, { style: "unit", unit: name, unitDisplay: "narrow" }).format(
      value,
    );
  if (ms >= DAY) return unit(Math.floor(ms / DAY), "day");
  if (ms >= HOUR) return unit(Math.floor(ms / HOUR), "hour");
  if (ms >= MINUTE) {
    const totalSeconds = Math.ceil(ms / SECOND);
    return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, "0")}`;
  }
  return unit(Math.ceil(ms / SECOND), "second");
}

// The same duration spelled out ("1 day 3 hours", "4 minutes 5 seconds"), for screen readers,
// where "2h" could mean anything from 2:00 to 2:59. Leaves out units too small to matter.
export function longDuration(language: string, ms: number): string {
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  const seconds = Math.ceil((ms % MINUTE) / SECOND);
  const parts: [number, "day" | "hour" | "minute" | "second"][] = [];
  if (days > 0) parts.push([days, "day"]);
  if (hours > 0) parts.push([hours, "hour"]);
  if (minutes > 0 && days === 0) parts.push([minutes, "minute"]);
  if (seconds > 0 && days === 0 && hours === 0) parts.push([seconds, "second"]);
  return new Intl.ListFormat(language, { type: "unit", style: "narrow" }).format(
    parts.map(([value, unit]) =>
      new Intl.NumberFormat(language, { style: "unit", unit, unitDisplay: "long" }).format(value),
    ),
  );
}

// "2 players", or "2–8 players" for a game that takes a range.
export function playerRange(t: TFunction, meta: GameMeta): string {
  return meta.minPlayers === meta.maxPlayers
    ? t("tile.players", { count: meta.minPlayers })
    : t("tile.playerRange", { min: meta.minPlayers, max: meta.maxPlayers });
}
