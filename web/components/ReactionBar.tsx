import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { MatchReaction, PlayerInfo } from "../../shared/protocol";
import { REACTIONS, REACTION_COOLDOWN_MS, REACTION_EMOJI } from "../../shared/reactions";
import type { Reaction } from "../../shared/reactions";
import { PlayerAvatar } from "./PlayerAvatar";

// How recent a reaction has to be to rise on screen when it arrives. Older
// ones — the latest few a page loads with — are only in the history panel.
// Generous, because the timestamp is the server's clock and this is the
// browser's.
const LIVE_WINDOW_MS = 10_000;

interface Bubble {
  reaction: MatchReaction;
  offset: number;
}

// The row of reactions a player can send, and the ones arriving from
// everyone (themselves included) rising from the foot of the screen. Each
// bubble is also announced, once, to a screen reader.
export function ReactionBar({
  reactions,
  players,
  onReact,
}: {
  reactions: MatchReaction[];
  players: PlayerInfo[];
  onReact: (reaction: Reaction) => void;
}) {
  const { t } = useTranslation();
  const [coolingDown, setCoolingDown] = useState(false);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const shown = useRef(new Set<number>());
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const now = Date.now();
    const fresh = reactions.filter(
      (r) => !shown.current.has(r.id) && Math.abs(now - r.ts) < LIVE_WINDOW_MS,
    );
    for (const r of reactions) shown.current.add(r.id);
    if (fresh.length === 0) return;
    setBubbles((prev) => [
      ...prev,
      ...fresh.map((reaction) => ({ reaction, offset: Math.round((Math.random() - 0.5) * 160) })),
    ]);
  }, [reactions]);

  // A bubble leaves once it has risen, which with reduced motion is at once.
  const pop = (id: number) => setBubbles((prev) => prev.filter((b) => b.reaction.id !== id));

  useEffect(
    () => () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    },
    [],
  );

  // The server refuses a second reaction inside the cooldown, so the buttons
  // wait it out rather than offer one that would bounce.
  function send(reaction: Reaction) {
    onReact(reaction);
    setCoolingDown(true);
    cooldownTimer.current = setTimeout(() => setCoolingDown(false), REACTION_COOLDOWN_MS);
  }

  const nameOf = (id: string) => players.find((p) => p.id === id)?.nickname ?? id;

  return (
    <>
      <div
        role="group"
        aria-label={t("reactions.label")}
        className="flex flex-wrap justify-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--border-subtle)] bg-surface/70 p-1.5 shadow-[var(--edge-highlight),var(--shadow-1)]"
      >
        {REACTIONS.map((reaction) => (
          <button
            key={reaction}
            type="button"
            disabled={coolingDown}
            onClick={() => send(reaction)}
            aria-label={t("reactions.send", { reaction: t(`reactions.names.${reaction}`) })}
            title={t(`reactions.names.${reaction}`)}
            className="flex size-11 cursor-pointer items-center justify-center rounded-full text-xl transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] not-disabled:hover:scale-125 not-disabled:hover:bg-[var(--surface-2)] not-disabled:active:scale-95 disabled:cursor-default disabled:opacity-50"
          >
            <span aria-hidden="true">{REACTION_EMOJI[reaction]}</span>
          </button>
        ))}
      </div>

      <div
        role="log"
        aria-label={t("reactions.live")}
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 h-0"
      >
        {bubbles.map(({ reaction, offset }) => (
          <div
            key={reaction.id}
            className="reaction-bubble flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--border-subtle)] bg-[var(--surface-1)] py-1 pr-3 pl-1 shadow-[var(--shadow-3)]"
            style={{ "--reaction-x": `${offset}px` } as React.CSSProperties}
            onAnimationEnd={() => pop(reaction.id)}
          >
            <PlayerAvatar id={reaction.by} nickname={nameOf(reaction.by)} size="sm" />
            <span aria-hidden="true" className="text-2xl leading-none">
              {REACTION_EMOJI[reaction.reaction]}
            </span>
            <span className="sr-only">
              {t("reactions.reacted", {
                name: nameOf(reaction.by),
                reaction: t(`reactions.names.${reaction.reaction}`),
              })}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
