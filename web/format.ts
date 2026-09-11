// Small formatting helpers shared by Dashboard and MatchPage. Pure and
// display-only — no protocol types live here.

export function relativeTime(epochMs: number, now: number = Date.now()): string {
  const diffMs = now - epochMs;
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.round(diffHour / 24);
  return `${diffDay}d ago`;
}

export function formatDeadline(epochMs: number, now: number = Date.now()): string {
  if (epochMs <= now) return "deadline passed";
  return `due ${relativeTime(epochMs, now).replace(" ago", "")}`;
}
