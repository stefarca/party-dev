import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import type { Result } from "../../shared/game";
import type { PlayerId, PlayerInfo } from "../../shared/protocol";

// The engine's "who is the game waiting on" answer, rendered generically —
// no game-specific knowledge belongs here, only `PlayerInfo`/`PlayerId`.

const URGENT_MS = 30_000;

function nameFor(players: PlayerInfo[], id: PlayerId): string {
  return players.find((p) => p.id === id)?.nickname ?? id;
}

function resultText(result: Result, players: PlayerInfo[], me: PlayerId): string {
  if (result.kind === "draw") return "It's a draw.";
  if (result.kind === "win") {
    if (result.winners.includes(me)) return "You won!";
    if (result.winners.length === 0) return "No winner.";
    return `${result.winners.map((w) => nameFor(players, w)).join(", ")} won.`;
  }
  // result.kind === "scores"
  const entries = Object.entries(result.scores).sort((a, b) => b[1] - a[1]);
  return `Final scores: ${entries.map(([id, score]) => `${nameFor(players, id)} ${score}`).join(", ")}`;
}

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export interface TurnIndicatorProps {
  me: PlayerId;
  players: PlayerInfo[];
  waitingOn: PlayerId[];
  deadline: number | null;
  result: Result | null;
}

export function TurnIndicator({ me, players, waitingOn, deadline, result }: TurnIndicatorProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null) return;
    // A plain browser `setInterval` — fine here. The ban on
    // timer-based intervals is scoped to Durable Objects (which must use
    // `ctx.storage.setAlarm()` instead); a browser tab has no such
    // constraint.
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  // Tracks when the current deadline first appeared, purely so the
  // depleting bar below has a duration to divide by — it never feeds back
  // into the countdown text itself.
  const spanRef = useRef<{ deadline: number; start: number } | null>(null);
  if (deadline === null) {
    spanRef.current = null;
  } else if (spanRef.current?.deadline !== deadline) {
    spanRef.current = { deadline, start: now };
  }

  if (result) {
    return (
      <div className="turn-banner turn-banner-done">
        <span className="turn-banner-label">Match finished.</span>
        <p className="turn-banner-result">{resultText(result, players, me)}</p>
      </div>
    );
  }

  const myTurn = waitingOn.includes(me);
  const label = myTurn
    ? "Your turn"
    : waitingOn.length === 0
      ? "Waiting…"
      : `Waiting on ${waitingOn.map((id) => nameFor(players, id)).join(", ")}`;

  const remainingMs = deadline !== null ? Math.max(0, deadline - now) : null;
  const span = spanRef.current;
  const totalMs = span ? span.deadline - span.start : null;
  const fraction =
    remainingMs !== null && totalMs !== null && totalMs > 0
      ? Math.min(1, remainingMs / totalMs)
      : 1;
  const urgent = remainingMs !== null && remainingMs > 0 && remainingMs <= URGENT_MS;
  const expired = remainingMs === 0;

  const classes = ["turn-banner", myTurn ? "turn-banner-mine" : "turn-banner-waiting"];
  if (urgent) classes.push("turn-banner-urgent");
  if (expired) classes.push("turn-banner-expired");

  return (
    <div className={classes.join(" ")}>
      <span className="turn-banner-label">{label}</span>
      {remainingMs !== null && (
        <div className="turn-countdown" style={{ "--remaining": fraction } as CSSProperties}>
          <span className="turn-countdown-bar" aria-hidden="true" />
          <span className="turn-countdown-time">{formatCountdown(remainingMs)}</span>
        </div>
      )}
    </div>
  );
}
