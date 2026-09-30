import type { DailyGameMeta } from "./game";

// A daily game's score as its chart shows it: a count with the language's own digit grouping, or a
// time as a stopwatch reads one ("1:05", "1:02:09"). Shared because two places put a score in
// front of a player: the client, and the Worker when it writes a challenge link's preview.
export function scoreText(
  language: string,
  value: number,
  format: DailyGameMeta["format"],
): string {
  if (format === "number") return new Intl.NumberFormat(language).format(value);
  const totalSeconds = Math.floor(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}
