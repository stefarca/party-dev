import type { TFunction } from "i18next";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Result } from "../../shared/game";
import type { PlayerId, PlayerInfo } from "../../shared/protocol";
import { longDuration, shortDuration } from "../format";
import { useLanguage } from "../i18n";
import { PlayerAvatar } from "./PlayerAvatar";

// The engine's "who is the game waiting on" answer, rendered generically —
// no game-specific knowledge belongs here, only `PlayerInfo`/`PlayerId`.

const URGENT_MS = 30_000;

function nameFor(players: PlayerInfo[], id: PlayerId): string {
  return players.find((p) => p.id === id)?.nickname ?? id;
}

// A headline plus one line of detail. The two never repeat each other: the
// headline says what happened to *you*, the detail says who else was
// involved.
function resultCopy(
  t: TFunction,
  result: Result,
  players: PlayerInfo[],
  me: PlayerId,
): { headline: string; detail: string } {
  if (result.kind === "draw") {
    return { headline: t("result.draw"), detail: t("result.drawDetail") };
  }
  if (result.kind === "win") {
    if (result.winners.includes(me)) {
      const beaten = players.filter((p) => !result.winners.includes(p.id));
      return {
        headline: t("result.won"),
        detail:
          beaten.length > 0
            ? t("result.youBeat", { names: beaten.map((p) => p.nickname).join(", ") })
            : t("result.wonAlone"),
      };
    }
    if (result.winners.length === 0) {
      return { headline: t("result.finished"), detail: t("result.noWinner") };
    }
    return {
      headline: t("result.finished"),
      detail: t("result.winners", {
        count: result.winners.length,
        names: result.winners.map((w) => nameFor(players, w)).join(", "),
      }),
    };
  }
  // result.kind === "scores"
  const entries = Object.entries(result.scores).sort((a, b) => b[1] - a[1]);
  return {
    headline: t("result.finished"),
    detail: t("result.scores", {
      scores: entries.map(([id, score]) => `${nameFor(players, id)} ${score}`).join(", "),
    }),
  };
}

// A depleting ring around the remaining time. Decorative: the same number is
// always printed inside it, and the whole control carries an aria-label, so
// the ring itself never has to be read. The number is at most four
// characters, because a turn deadline is routinely a day away and a player
// with 24 hours left does not need the seconds.
function CountdownRing({
  fraction,
  remainingMs,
  tone,
}: {
  fraction: number;
  remainingMs: number;
  tone: string;
}) {
  const { t } = useTranslation();
  const language = useLanguage();
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  return (
    <div
      className="relative flex size-14 flex-none items-center justify-center"
      role="timer"
      aria-label={
        remainingMs <= 0
          ? t("turn.timeUp")
          : t("turn.remaining", { time: longDuration(language, remainingMs) })
      }
    >
      <svg viewBox="0 0 48 48" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
        <circle cx="24" cy="24" r={radius} fill="none" stroke="var(--surface-3)" strokeWidth="4" />
        <circle
          cx="24"
          cy="24"
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          className="transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
      </svg>
      <span
        aria-hidden="true"
        className="font-display text-sm font-bold tabular-nums"
        style={{ color: tone }}
      >
        {shortDuration(language, remainingMs)}
      </span>
    </div>
  );
}

export interface TurnIndicatorProps {
  me: PlayerId;
  players: PlayerInfo[];
  waitingOn: PlayerId[];
  deadline: number | null;
  result: Result | null;
}

export function TurnIndicator({ me, players, waitingOn, deadline, result }: TurnIndicatorProps) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null) return;
    // A plain browser `setInterval` — fine here. The ban on timer-based
    // intervals is scoped to Durable Objects (which must use
    // `ctx.storage.setAlarm()` instead); a browser tab has no such
    // constraint.
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  // Tracks when the current deadline first appeared, purely so the depleting
  // ring above has a duration to divide by — it never feeds back into the
  // countdown text itself.
  const spanRef = useRef<{ deadline: number; start: number } | null>(null);
  if (deadline === null) {
    spanRef.current = null;
  } else if (spanRef.current?.deadline !== deadline) {
    spanRef.current = { deadline, start: now };
  }

  if (result) {
    const won = result.kind === "win" && result.winners.includes(me);
    const copy = resultCopy(t, result, players, me);
    return (
      <div
        className="party-pop flex items-center gap-4 rounded-[var(--radius-xl)] border-2 p-5"
        style={{
          borderColor: won ? "var(--ok-border)" : "var(--border-subtle)",
          background: won ? "var(--ok-soft)" : "var(--surface-1)",
          boxShadow: "var(--edge-highlight), var(--shadow-2)",
        }}
      >
        <span
          aria-hidden="true"
          className="text-4xl"
          style={
            won ? { animation: "party-celebrate 1.6s var(--ease-spring) infinite" } : undefined
          }
        >
          {won ? "🏆" : "🎬"}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="font-display text-xl font-bold text-[var(--text-primary)]">
            {copy.headline}
          </span>
          <p className="m-0 text-sm text-[var(--text-secondary)]">{copy.detail}</p>
        </div>
      </div>
    );
  }

  const myTurn = waitingOn.includes(me);
  const waitingPlayers = waitingOn
    .map((id) => players.find((p) => p.id === id))
    .filter((p): p is PlayerInfo => p !== undefined);
  const label = myTurn
    ? t("turn.yours")
    : waitingOn.length === 0
      ? t("turn.waiting")
      : t("turn.waitingOn", { names: waitingOn.map((id) => nameFor(players, id)).join(", ") });

  const remainingMs = deadline !== null ? Math.max(0, deadline - now) : null;
  const span = spanRef.current;
  const totalMs = span ? span.deadline - span.start : null;
  const fraction =
    remainingMs !== null && totalMs !== null && totalMs > 0
      ? Math.min(1, remainingMs / totalMs)
      : 1;
  const urgent = remainingMs !== null && remainingMs > 0 && remainingMs <= URGENT_MS;
  const expired = remainingMs === 0;
  const tone = expired ? "var(--danger-fg)" : urgent ? "var(--warn-fg)" : "var(--accent)";

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-xl)] border-2 p-5 ${
        myTurn ? "turn-pulse" : ""
      }`}
      style={{
        borderColor: myTurn ? "var(--border-accent)" : "var(--border-subtle)",
        background: myTurn ? "var(--accent-soft)" : "var(--surface-1)",
        boxShadow: myTurn ? undefined : "var(--edge-highlight), var(--shadow-1)",
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        {myTurn ? (
          <span
            aria-hidden="true"
            className="flex size-11 flex-none items-center justify-center rounded-full text-xl"
            style={{
              background: "var(--accent)",
              color: "var(--text-on-accent)",
              animation: "party-float 2.4s var(--ease-out) infinite",
            }}
          >
            ▸
          </span>
        ) : (
          <span className="flex flex-none -space-x-2" aria-hidden="true">
            {waitingPlayers.slice(0, 3).map((p) => (
              <PlayerAvatar key={p.id} id={p.id} nickname={p.nickname} size="md" />
            ))}
          </span>
        )}
        <div className="flex min-w-0 flex-col">
          <span
            className="truncate font-display text-lg font-bold"
            style={{ color: myTurn ? "var(--accent-on-soft)" : "var(--text-secondary)" }}
          >
            {label}
          </span>
          {myTurn && <span className="text-xs text-[var(--text-muted)]">{t("turn.makeMove")}</span>}
        </div>
      </div>
      {remainingMs !== null && (
        <CountdownRing fraction={fraction} remainingMs={remainingMs} tone={tone} />
      )}
    </div>
  );
}
