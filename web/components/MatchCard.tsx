import type { CSSProperties } from "react";

import type { MatchStatus, MatchSummary } from "../../shared/protocol";
import { formatDeadline, relativeTime } from "../format";
import { navigate } from "../router";
import { GameGlyph } from "./GameGlyph";
import { PlayerAvatar } from "./PlayerAvatar";

const STATUS_STYLE: Record<MatchStatus, { label: string; fill: string; ink: string }> = {
  lobby: { label: "Lobby", fill: "var(--party-pink-soft)", ink: "var(--party-pink-on-soft)" },
  active: { label: "Playing", fill: "var(--ok-soft)", ink: "var(--ok-fg)" },
  done: { label: "Finished", fill: "var(--surface-3)", ink: "var(--text-muted)" },
};

// One match in any of the hub's buckets. `accent` lifts the card for the
// "your turn" bucket — it is paired with the section heading and the card's
// own "Your move" line, so the colour is never the only thing saying so.
export function MatchCard({
  match,
  gameName,
  myPlayerId,
  accent = false,
  style,
}: {
  match: MatchSummary;
  gameName: string;
  myPlayerId: string;
  accent?: boolean;
  style?: CSSProperties;
}) {
  const others = match.players.filter((p) => p.id !== myPlayerId);
  const status = STATUS_STYLE[match.status];

  return (
    <a
      href={`/m/${match.id}`}
      style={style}
      onClick={(e) => {
        e.preventDefault();
        navigate(`/m/${match.id}`);
      }}
      className={`party-pop group flex flex-col gap-3 rounded-[var(--radius-lg)] border-2 p-4 no-underline transition-[transform,box-shadow,border-color] duration-[var(--dur-base)] ease-[var(--ease-spring)] hover:-translate-y-1 hover:shadow-[var(--shadow-3),var(--edge-highlight)] active:translate-y-0 ${
        accent
          ? "border-[var(--border-accent)] bg-[var(--surface-1)] shadow-[var(--shadow-2),var(--glow-accent)]"
          : "border-[var(--border-subtle)] bg-[var(--surface-1)] shadow-[var(--shadow-1),var(--edge-highlight)]"
      }`}
    >
      <div className="flex items-start gap-3">
        <GameGlyph
          gameId={match.gameId}
          className="size-11 transition-transform duration-[var(--dur-base)] ease-[var(--ease-bounce)] group-hover:-rotate-6 group-hover:scale-110"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-display text-base font-bold text-[var(--text-primary)]">
            {gameName}
          </span>
          <span className="truncate text-sm text-[var(--text-muted)]">
            {others.length > 0
              ? others.map((p) => p.nickname).join(", ")
              : "waiting for others to join"}
          </span>
        </div>
        <span
          className="flex-none rounded-[var(--radius-pill)] px-2.5 py-1 text-xs font-bold"
          style={{ background: status.fill, color: status.ink }}
        >
          {status.label}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="flex -space-x-2" aria-hidden="true">
          {others.slice(0, 4).map((p) => (
            <PlayerAvatar key={p.id} id={p.id} nickname={p.nickname} size="sm" />
          ))}
        </span>
        <span className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
          {accent && <span className="font-bold text-[var(--accent-on-soft)]">Your move</span>}
          <span>{relativeTime(match.updatedAt)}</span>
          {match.deadline !== null && (
            <span className="font-mono tabular-nums">{formatDeadline(match.deadline)}</span>
          )}
        </span>
      </div>
    </a>
  );
}
