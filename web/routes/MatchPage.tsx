import { Button } from "@heroui/react";
import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import type { ComponentType, LazyExoticComponent, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { GameMeta } from "../../games/catalog";
import { getGameMeta } from "../../games/catalog";
import { gameUi } from "../../games/registry";
import type {
  GameUiProps,
  MatchEvent,
  MatchStatus,
  MatchSnapshot,
  MatchSummary,
  MatchVisibility,
} from "../../shared/protocol";
import { ApiError, getMatch, joinMatch, setMatchVisibility } from "../api";
import { clearMatchWaiting, setMatchWaiting } from "../badge";
import { ConnectionBadge } from "../components/ConnectionBadge";
import { Confetti } from "../components/Confetti";
import { DebugGameView } from "../components/DebugGameView";
import { GameGlyph } from "../components/GameGlyph";
import { GameSurface } from "../components/GameSurface";
import { HistoryPanel } from "../components/HistoryPanel";
import { EmptyAvatar, PlayerAvatar } from "../components/PlayerAvatar";
import { Notice, Skeleton } from "../components/states";
import { TurnIndicator } from "../components/TurnIndicator";
import { VisibilitySwitch } from "../components/VisibilitySwitch";
import { errorText } from "../errors";
import { playerRange } from "../format";
import { useGameName } from "../i18n";
import { navigate } from "../router";
import { useSession } from "../session";
import type { ConnectionState, MatchError } from "../useMatch";
import { useMatch } from "../useMatch";

const STATUS_STYLE: Record<MatchStatus, { fill: string; ink: string }> = {
  lobby: { fill: "var(--party-pink-soft)", ink: "var(--party-pink-on-soft)" },
  active: { fill: "var(--ok-soft)", ink: "var(--ok-fg)" },
  done: { fill: "var(--surface-3)", ink: "var(--text-muted)" },
};

function MatchHeader({
  name,
  gameId,
  status,
  connection,
  showConnection,
}: {
  name: string;
  gameId: string;
  status: MatchStatus;
  connection: ConnectionState;
  showConnection: boolean;
}) {
  const { t } = useTranslation();
  const style = STATUS_STYLE[status];
  return (
    <div className="party-pop mb-6 flex flex-wrap items-center gap-3">
      <GameGlyph gameId={gameId} className="size-12" />
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="m-0 truncate font-display text-2xl font-bold text-[var(--text-primary)]">
          {name}
        </h1>
        <span
          className="w-fit rounded-[var(--radius-pill)] px-2 py-0.5 text-xs font-bold"
          style={{ background: style.fill, color: style.ink }}
        >
          {t(`status.${status}`)}
        </span>
      </div>
      {showConnection && <ConnectionBadge connection={connection} />}
    </div>
  );
}

// Reserves roughly the header + invite panel footprint while the initial
// `getMatch()` fetch is in flight.
function MatchSkeleton() {
  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <Skeleton width="3rem" height="3rem" rounded="md" />
        <Skeleton width="10rem" height="2rem" rounded="lg" />
      </div>
      <Skeleton height="11rem" className="mb-4" rounded="xl" />
      <Skeleton height="14rem" rounded="xl" />
    </>
  );
}

// Reserves roughly the cabinet's footprint for the brief window between the
// lobby summary reporting the match has started and the live snapshot
// actually arriving.
function GameSurfaceSkeleton() {
  return (
    <div className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-subtle)] shadow-[var(--shadow-3)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-2)] px-5 py-3">
        <Skeleton width="8rem" height="1.2rem" rounded="pill" />
      </div>
      <div className="bg-[var(--surface-inset)] p-5">
        <Skeleton height="14rem" rounded="lg" />
      </div>
    </div>
  );
}

// `children` goes at the foot of the full panel, and is dropped once it has
// collapsed: whatever it holds is about getting people into the lobby.
function ShareCode({
  code,
  collapsed,
  children,
}: {
  code: string;
  collapsed: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const url = `${window.location.origin}/m/${code}`;

  async function copy() {
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      } catch {
        // Fall through to the selection fallback below.
      }
    }
    // Clipboard API needs a secure context; on plain http (non-localhost) or
    // if it's unavailable, select the text so the user can copy manually.
    inputRef.current?.select();
  }

  const shareInput = (
    <input
      ref={inputRef}
      id="match-share-url"
      readOnly
      value={url}
      aria-label={t("share.linkLabel")}
      className={
        collapsed
          ? "sr-only"
          : "w-full rounded-[var(--radius-pill)] bg-[var(--surface-inset)] px-4 py-2 text-center font-mono text-xs text-[var(--text-muted)] shadow-[var(--shadow-inset)]"
      }
      tabIndex={collapsed ? -1 : undefined}
    />
  );

  if (collapsed) {
    return (
      <div className="inline-flex">
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--border-subtle)] bg-[var(--surface-2)] px-4 py-1 text-xs font-bold text-[var(--text-secondary)] shadow-[var(--edge-highlight)] transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] hover:scale-105 active:scale-95"
        >
          <span className="font-mono tracking-[0.15em]">{code}</span>
          <span className="text-[var(--accent-on-soft)]">
            {copied ? t("share.copied") : t("share.copy")}
          </span>
        </button>
        {shareInput}
      </div>
    );
  }

  return (
    <section className="party-pop flex flex-col items-center gap-4 rounded-[var(--radius-xl)] border-2 border-[var(--border-accent)] bg-[var(--surface-1)] p-6 text-center shadow-[var(--shadow-2),var(--glow-accent)]">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 font-display text-xl font-bold text-[var(--text-primary)]">
          {t("share.title")}
        </h2>
        <p className="m-0 text-sm text-[var(--text-muted)]">{t("share.body")}</p>
      </div>
      <div aria-hidden="true" className="flex justify-center gap-1.5 sm:gap-2">
        {code.split("").map((ch, i) => (
          <span
            key={i}
            className="party-pop flex h-12 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--surface-inset)] font-display text-2xl font-bold uppercase shadow-[var(--shadow-inset),var(--edge-highlight)] sm:h-14 sm:w-11 sm:text-3xl"
            style={{ "--pop-delay": `${i * 60}ms` } as React.CSSProperties}
          >
            {ch}
          </span>
        ))}
      </div>
      {shareInput}
      <Button
        onPress={copy}
        className="rounded-[var(--radius-pill)] px-6 font-display font-bold transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] hover:scale-105 active:scale-95"
      >
        {copied ? t("share.copiedCheck") : t("share.copy")}
      </Button>
      {children}
    </section>
  );
}

// The host's say over who can join, for as long as the match is a lobby. The
// switch moves as soon as it is pressed and moves back if the change is
// refused. It is disabled while a change is in flight, so two presses can
// never land out of order.
function HostVisibility({
  code,
  visibility,
  onChanged,
}: {
  code: string;
  visibility: MatchVisibility;
  onChanged: (match: MatchSummary) => void;
}) {
  const { t } = useTranslation();
  const { notifyUnauthorized } = useSession();
  const [shown, setShown] = useState(visibility);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: MatchVisibility) {
    setShown(next);
    setPending(true);
    setError(null);
    try {
      const updated = await setMatchVisibility(code, next);
      setShown(updated.visibility);
      onChanged(updated);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        notifyUnauthorized();
        return;
      }
      setShown(visibility);
      setError(errorText(t, err, t("visibility.failed")));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2 border-t border-[var(--border-subtle)] pt-4">
      <VisibilitySwitch visibility={shown} onChange={change} isDisabled={pending} />
      {error && (
        <p role="alert" className="m-0 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function Roster({
  players,
  meta,
  hostId,
  myPlayerId,
}: {
  players: MatchSummary["players"];
  meta: GameMeta | undefined;
  hostId: string;
  myPlayerId: string;
}) {
  const { t } = useTranslation();
  // Draw only the seats the game still *needs* to start, and summarise the
  // optional ones in a line. A 2-8 player game with one player in it would
  // otherwise open with seven identical dashed rows to scroll past.
  const requiredSeats = meta ? Math.max(0, meta.minPlayers - players.length) : 0;
  const optionalSeats = meta ? Math.max(0, meta.maxPlayers - players.length - requiredSeats) : 0;

  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {players.map((p, i) => (
        <li
          key={p.id}
          style={{ "--pop-delay": `${i * 60}ms` } as React.CSSProperties}
          className="party-pop flex items-center gap-3 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-2.5"
        >
          <PlayerAvatar id={p.id} nickname={p.nickname} size="md" />
          <span className="min-w-0 flex-1 truncate font-bold text-[var(--text-primary)]">
            {p.nickname}
          </span>
          <span className="flex flex-none gap-1.5">
            {p.id === hostId && (
              <span className="rounded-[var(--radius-pill)] bg-[var(--surface-3)] px-2 py-0.5 text-xs font-bold text-[var(--text-muted)]">
                {t("lobby.host")}
              </span>
            )}
            {p.id === myPlayerId && (
              <span
                className="rounded-[var(--radius-pill)] px-2 py-0.5 text-xs font-bold"
                style={{ background: "var(--accent-soft)", color: "var(--accent-on-soft)" }}
              >
                {t("lobby.you")}
              </span>
            )}
          </span>
        </li>
      ))}
      {Array.from({ length: requiredSeats }).map((_, i) => (
        <li
          key={`seat-${i}`}
          className="flex items-center gap-3 rounded-[var(--radius-md)] border-2 border-dashed border-[var(--border-subtle)] p-2.5 text-[var(--text-muted)]"
        >
          <EmptyAvatar size="md" />
          <span className="flex-1 text-sm italic">{t("lobby.openSeat")}</span>
        </li>
      ))}
      {optionalSeats > 0 && (
        <li className="px-2 pt-1 text-xs text-[var(--text-muted)]">
          {t("lobby.roomFor", { count: optionalSeats })}
        </li>
      )}
    </ul>
  );
}

// Caches the `React.lazy` wrapper per gameId (module-level, not per render):
// `lazy()` must be called exactly once for a given loader — calling it again
// on every render would remount the underlying component (and re-trigger
// Suspense) every time this component re-renders, not just once per game.
const lazyUiCache = new Map<string, LazyExoticComponent<ComponentType<GameUiProps>>>();

function getLazyUi(gameId: string): LazyExoticComponent<ComponentType<GameUiProps>> | undefined {
  const loader = gameUi[gameId];
  if (!loader) return undefined;
  let cached = lazyUiCache.get(gameId);
  if (!cached) {
    cached = lazy(loader);
    lazyUiCache.set(gameId, cached);
  }
  return cached;
}

// Catches a throw from a broken game module's render so it degrades to
// `fallback` instead of white-screening the whole app. `key`d by match code
// from the caller so navigating to a different match always starts with a
// clean (non-tripped) boundary.
class GameErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error("game UI crashed", error, info);
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function GameUiHost({
  code,
  gameId,
  snapshot,
  me,
  send,
}: {
  code: string;
  gameId: string;
  snapshot: MatchSnapshot;
  me: string;
  send: (action: unknown) => void;
}) {
  const { t } = useTranslation();
  const gameName = useGameName();
  const props: GameUiProps = {
    view: snapshot.view,
    me,
    players: snapshot.players,
    waitingOn: snapshot.waitingOn,
    deadline: snapshot.deadline,
    result: snapshot.result,
    send,
  };

  const title = gameName(gameId, getGameMeta(gameId)?.name);
  const Lazy = getLazyUi(gameId);
  if (!Lazy) {
    return (
      <GameSurface title={title}>
        <DebugGameView {...props} />
      </GameSurface>
    );
  }

  return (
    <GameSurface title={title}>
      <GameErrorBoundary key={code} fallback={<DebugGameView {...props} />}>
        <Suspense
          fallback={
            <div role="status">
              <span className="sr-only">{t("match.loadingGame")}</span>
              <Skeleton height="14rem" rounded="lg" />
            </div>
          }
        >
          <Lazy {...props} />
        </Suspense>
      </GameErrorBoundary>
    </GameSurface>
  );
}

// The live transport mounts here in place of the static lobby/placeholder
// body, keyed off `match.status`. Keep this component thin — no
// game-specific logic belongs in MatchPage.
//
// `match` (the lobby summary) is still the source of `hostId` and `gameId`,
// neither of which appears in `MatchSnapshot` — they never change for the
// lifetime of a match, so there is no freshness concern in reading them from
// the one-shot `getMatch()` load. Everything that *does* change live
// (status, players, whose turn it is) is read from `snapshot` once it
// exists, falling back to `match`'s own copy before the first snapshot
// arrives.
function MatchBody({
  match,
  snapshot,
  events,
  transportError,
  send,
  start,
  myPlayerId,
  isMember,
}: {
  match: MatchSummary;
  snapshot: MatchSnapshot | null;
  events: MatchEvent[];
  transportError: MatchError | null;
  send: (action: unknown) => void;
  start: () => void;
  myPlayerId: string;
  isMember: boolean;
}) {
  const { t } = useTranslation();
  const gameName = useGameName();
  const meta = getGameMeta(match.gameId);
  const status = snapshot?.status ?? match.status;
  const players = snapshot?.players ?? match.players;

  if (status === "lobby") {
    const isHost = myPlayerId === match.hostId;
    const count = players.length;
    const canStart =
      isHost && meta !== undefined && count >= meta.minPlayers && count <= meta.maxPlayers;

    return (
      <section className="party-pop flex flex-col gap-4 rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-5 shadow-[var(--shadow-2),var(--edge-highlight)]">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="m-0 font-display text-lg font-bold text-[var(--text-primary)]">
            {t("lobby.players")}
          </h2>
          {meta && (
            <span className="text-sm text-[var(--text-muted)]">
              {count}/{meta.maxPlayers}
            </span>
          )}
        </div>
        <Roster players={players} meta={meta} hostId={match.hostId} myPlayerId={myPlayerId} />
        {meta && (
          <p className="m-0 text-sm text-[var(--text-muted)]">
            {t("lobby.needs", {
              game: gameName(match.gameId, meta.name),
              players: playerRange(t, meta),
            })}
            {isHost ? "" : ` ${t("lobby.waitingForHost")}`}
          </p>
        )}
        {isHost && (
          <Button
            onPress={start}
            isDisabled={!canStart}
            className="self-start rounded-[var(--radius-pill)] px-6 font-display font-bold transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] not-disabled:hover:scale-105 not-disabled:active:scale-95"
          >
            {t("lobby.start")}
          </Button>
        )}
        {transportError && (
          <Notice tone="danger" role="status">
            {errorText(t, transportError, t("match.failed"))}
          </Notice>
        )}
      </section>
    );
  }

  // Someone who opened a shared link after the match had already started was
  // never joined (only a lobby accepts new players), so no snapshot will ever
  // arrive for them. Say so, rather than leaving a skeleton shimmering
  // forever.
  if (!isMember) {
    return <Notice tone="info">{t("match.notAPlayer")}</Notice>;
  }

  // active / done — the game itself needs the live snapshot, which may still
  // be in flight for a brief instant right after the lobby summary (loaded
  // first) reports the match has already started elsewhere.
  if (!snapshot) {
    return <GameSurfaceSkeleton />;
  }

  const won = snapshot.result?.kind === "win" && snapshot.result.winners.includes(myPlayerId);

  return (
    <div className="flex flex-col gap-4">
      <Confetti fire={won} />
      <TurnIndicator
        me={myPlayerId}
        players={snapshot.players}
        waitingOn={snapshot.waitingOn}
        deadline={snapshot.deadline}
        result={snapshot.result}
      />
      <GameUiHost
        code={match.id}
        gameId={match.gameId}
        snapshot={snapshot}
        me={myPlayerId}
        send={send}
      />
      {transportError && (
        <Notice tone="danger" role="status">
          {errorText(t, transportError, t("match.failed"))}
        </Notice>
      )}
      <HistoryPanel events={events} players={snapshot.players} gameId={match.gameId} />
      {snapshot.result && (
        <Button
          variant="ghost"
          onPress={() => navigate("/")}
          className="self-start rounded-[var(--radius-pill)] font-bold"
        >
          {t("match.backToHub")}
        </Button>
      )}
    </div>
  );
}

export function MatchPage({ code }: { code: string }) {
  const { t } = useTranslation();
  const gameName = useGameName();
  const { player, notifyUnauthorized } = useSession();
  const [match, setMatch] = useState<MatchSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let result = await getMatch(code);
      // A visitor who landed here via the shared "Copy link" URL (rather
      // than the hub's join form) has never called `/join` — reading the
      // lobby doesn't require membership, but rendering it as if they're in
      // it would be misleading, and the live transport's own /view check
      // would 403 them as `not_a_player`. Join on their behalf the first
      // time they see a lobby they're not part of.
      if (
        result.status === "lobby" &&
        player &&
        !result.players.some((p) => p.id === player.playerId)
      ) {
        result = await joinMatch(code);
      }
      setMatch(result);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        notifyUnauthorized();
        return;
      }
      setError(errorText(t, err, t("match.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [code, notifyUnauthorized, player, t]);

  useEffect(() => {
    load();
  }, [load]);

  const myPlayerId = player?.playerId ?? "";

  // Only open the live transport once `load()` has confirmed this player is
  // actually in the roster (joining them first if they arrived via a shared
  // link). Connecting any earlier races that join — see useMatch's own
  // comment on `ready` for why that race turns into a permanent failure
  // rather than a transient one.
  const isMember = match !== null && match.players.some((p) => p.id === myPlayerId);
  const ready = !loading && !error && isMember;

  const {
    snapshot,
    events,
    connection,
    error: transportError,
    send,
    start,
  } = useMatch(code, ready, notifyUnauthorized);

  // Tab badge: keep it live from this match's own snapshot stream between
  // hub visits — a WS push that makes it this player's turn updates the
  // badge immediately, rather than waiting for the next time the hub is
  // mounted/polled. `setDashboardYourTurn` (called from Dashboard on every
  // fetch) remains the authoritative resync.
  useEffect(() => {
    if (!snapshot || !myPlayerId) return;
    setMatchWaiting(code, snapshot.waitingOn.includes(myPlayerId));
  }, [code, snapshot, myPlayerId]);

  useEffect(() => {
    return () => clearMatchWaiting(code);
  }, [code]);

  const meta = match ? getGameMeta(match.gameId) : undefined;
  const status = snapshot?.status ?? match?.status;

  return (
    <main id="main-content" className="app-container">
      <a
        href="/"
        onClick={(e) => {
          e.preventDefault();
          navigate("/");
        }}
        className="mb-4 inline-flex items-center gap-1 text-sm font-bold text-[var(--text-muted)] no-underline transition-colors hover:text-[var(--text-primary)]"
      >
        {t("match.hub")}
      </a>

      {match && (
        <MatchHeader
          name={gameName(match.gameId, meta?.name)}
          gameId={match.gameId}
          status={status ?? match.status}
          connection={connection}
          showConnection={isMember}
        />
      )}

      {loading && <MatchSkeleton />}

      {!loading && error && (
        <Notice tone="danger" action={{ label: t("retry"), onClick: () => load() }}>
          {error}
        </Notice>
      )}

      {!loading && !error && match && (
        <div className="flex flex-col gap-4">
          <ShareCode code={code} collapsed={status !== "lobby"}>
            {match.hostId === myPlayerId && (
              <HostVisibility code={code} visibility={match.visibility} onChanged={setMatch} />
            )}
          </ShareCode>
          <MatchBody
            match={match}
            snapshot={snapshot}
            events={events}
            transportError={transportError}
            send={send}
            start={start}
            myPlayerId={myPlayerId}
            isMember={isMember}
          />
        </div>
      )}
    </main>
  );
}
