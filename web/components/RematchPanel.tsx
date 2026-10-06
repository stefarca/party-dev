import { Button } from "@heroui/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { MatchSnapshot, PlayerId, PlayerInfo } from "../../shared/protocol";
import { ApiError, requestRematch } from "../api";
import { errorText } from "../errors";
import { navigate } from "../router";
import { useSession } from "../session";
import { Notice } from "./states";
import { PlayerAvatar } from "./PlayerAvatar";

const PILL =
  "rounded-[var(--radius-pill)] px-6 font-display font-bold transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] not-disabled:hover:scale-105 not-disabled:active:scale-95";

// What a finished match offers next: a rematch between the same players, or
// the way back to the hub. The first player to ask opens the next match's
// lobby and goes there; everyone else is offered that same lobby, which
// opening it joins them to. The offer appears live on every page watching
// the match, since the server pushes a fresh snapshot when it is made.
export function RematchPanel({
  code,
  rematch,
  players,
  me,
}: {
  code: string;
  rematch: MatchSnapshot["rematch"];
  players: PlayerInfo[];
  me: PlayerId;
}) {
  const { t } = useTranslation();
  const { notifyUnauthorized } = useSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setPending(true);
    setError(null);
    try {
      navigate(`/m/${await requestRematch(code)}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        notifyUnauthorized();
        return;
      }
      setError(errorText(t, err, t("rematch.failed")));
    } finally {
      setPending(false);
    }
  }

  const asker = rematch && rematch.by !== me ? players.find((p) => p.id === rematch.by) : null;

  return (
    <section className="party-pop flex flex-col gap-3 rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4 shadow-[var(--shadow-2),var(--edge-highlight)]">
      {asker && (
        <p className="m-0 flex items-center gap-2 font-display font-bold text-[var(--text-primary)]">
          <PlayerAvatar id={asker.id} nickname={asker.nickname} size="sm" />
          {t("rematch.offered", { name: asker.nickname })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {rematch ? (
          <Button onPress={() => navigate(`/m/${rematch.matchId}`)} className={PILL}>
            {rematch.by === me ? t("rematch.open") : t("rematch.join")}
          </Button>
        ) : (
          <Button onPress={() => void ask()} isDisabled={pending} className={PILL}>
            {t("rematch.offer")}
          </Button>
        )}
        <Button
          variant="ghost"
          onPress={() => navigate("/")}
          className="rounded-[var(--radius-pill)] font-bold"
        >
          {t("match.backToHub")}
        </Button>
      </div>
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
    </section>
  );
}
