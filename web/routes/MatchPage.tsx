import { Avatar, Button, Card, Chip } from "@heroui/react";
import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import type { ComponentProps, ComponentType, LazyExoticComponent, ReactNode } from "react";

import type { GameMeta } from "../../games/catalog";
import { getGameMeta } from "../../games/catalog";
import { gameUi } from "../../games/registry";
import type {
  GameUiProps,
  MatchEvent,
  MatchStatus,
  MatchSnapshot,
  MatchSummary,
} from "../../shared/protocol";
import { ApiError, getMatch, joinMatch } from "../api";
import { clearMatchWaiting, setMatchWaiting } from "../badge";
import { ConnectionBadge } from "../components/ConnectionBadge";
import { DebugGameView } from "../components/DebugGameView";
import { GameSurface } from "../components/GameSurface";
import { HistoryPanel } from "../components/HistoryPanel";
import { Notice, Skeleton } from "../components/states";
import { TurnIndicator } from "../components/TurnIndicator";
import { useSession } from "../session";
import type { ConnectionState, MatchError } from "../useMatch";
import { useMatch } from "../useMatch";

function statusChipColor(status: MatchStatus): ComponentProps<typeof Chip>["color"] {
  if (status === "lobby") return "accent";
  if (status === "active") return "success";
  return "default";
}

function MatchHeader({
  name,
  status,
  connection,
}: {
  name: string;
  status: MatchStatus;
  connection: ConnectionState;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="m-0 text-xl font-bold text-foreground">{name}</h1>
      <div className="flex items-center gap-3">
        <Chip color={statusChipColor(status)} size="sm">
          {status}
        </Chip>
        <ConnectionBadge connection={connection} />
      </div>
    </div>
  );
}

// Reserves roughly the header + share panel + roster panel footprint while
// the initial `getMatch()` fetch is in flight.
function MatchSkeleton() {
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Skeleton width="10rem" height="1.5rem" />
        <Skeleton width="5rem" height="1.3rem" />
      </div>
      <div className="mb-4 rounded-lg border border-border bg-surface p-4 shadow-[var(--edge-highlight),var(--shadow-2)]">
        <Skeleton width="60%" height="1.1rem" className="mb-3" />
        <Skeleton height="4rem" />
      </div>
    </>
  );
}

// Reserves roughly the cabinet's footprint for the brief window between the
// lobby summary reporting the match has started and the live snapshot
// actually arriving.
function GameSurfaceSkeleton() {
  return (
    <div className="mb-4 overflow-hidden rounded-3xl shadow-[var(--shadow-3),var(--edge-highlight)]">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
        <Skeleton width="8rem" height="1.2rem" />
      </div>
      <div className="flex flex-col gap-2 bg-[var(--surface-inset)] p-2 shadow-[var(--shadow-inset)] sm:p-4">
        <Skeleton height="12rem" />
      </div>
    </div>
  );
}

function ShareCode({ code, collapsed }: { code: string; collapsed: boolean }) {
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
      className={collapsed ? "sr-only" : "mb-3 text-center font-mono text-sm text-muted"}
      tabIndex={collapsed ? -1 : undefined}
    />
  );

  if (collapsed) {
    return (
      <div className="mb-4 inline-flex">
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface-secondary px-3 py-1 text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase shadow-[var(--edge-highlight)] transition-transform hover:-translate-y-0.5 active:translate-y-0"
        >
          <span className="font-mono tracking-[0.1em]">{code}</span>
          {copied ? "Copied!" : "Copy link"}
        </button>
        {shareInput}
      </div>
    );
  }

  return (
    <Card className="mb-4 border-[var(--border-accent)] text-center shadow-[var(--edge-highlight),var(--shadow-2),var(--glow-accent)]">
      <Card.Content className="items-center gap-3">
        <Card.Title>Invite players</Card.Title>
        <div aria-hidden="true" className="mb-3 flex justify-center gap-2">
          {code.split("").map((ch, i) => (
            <span
              key={i}
              className="flex h-9 w-7 items-center justify-center rounded-md bg-[var(--surface-inset)] font-mono text-xl font-bold uppercase shadow-[var(--shadow-inset),var(--edge-highlight)] sm:h-11 sm:w-9"
            >
              {ch}
            </span>
          ))}
        </div>
        {shareInput}
        <Button onPress={copy}>{copied ? "Copied!" : "Copy link"}</Button>
      </Card.Content>
    </Card>
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
  const emptySeats = meta ? Math.max(0, meta.maxPlayers - players.length) : 0;

  return (
    <ul className="m-0 mb-3 flex list-none flex-col gap-2 p-0">
      {players.map((p) => (
        <li key={p.id} className="flex items-center gap-3 rounded-md bg-surface-secondary p-2">
          <Avatar size="sm" aria-hidden="true">
            <Avatar.Fallback
              className="font-bold"
              style={{ backgroundColor: "var(--accent)", color: "var(--accent-contrast)" }}
            >
              {p.nickname.charAt(0).toUpperCase()}
            </Avatar.Fallback>
          </Avatar>
          <span className="flex-1 font-semibold text-foreground">{p.nickname}</span>
          <span className="flex gap-1">
            {p.id === hostId && <Chip size="sm">host</Chip>}
            {p.id === myPlayerId && (
              <Chip size="sm" color="accent">
                you
              </Chip>
            )}
          </span>
        </li>
      ))}
      {Array.from({ length: emptySeats }).map((_, i) => (
        <li
          key={`seat-${i}`}
          className="flex items-center gap-3 rounded-md border border-dashed border-border p-2 text-muted"
        >
          <Avatar
            size="sm"
            aria-hidden="true"
            className="border border-dashed border-[var(--border-strong)] bg-transparent"
          >
            <Avatar.Fallback className="bg-transparent text-muted">?</Avatar.Fallback>
          </Avatar>
          <span className="flex-1 italic">Open seat</span>
        </li>
      ))}
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
// `fallback` instead of white-screening the whole app.
// `key`d by match code from the caller so navigating to a different match
// always starts with a clean (non-tripped) boundary.
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
  const props: GameUiProps = {
    view: snapshot.view,
    me,
    players: snapshot.players,
    waitingOn: snapshot.waitingOn,
    deadline: snapshot.deadline,
    result: snapshot.result,
    send,
  };

  const title = getGameMeta(gameId)?.name ?? gameId;
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
              <span className="sr-only">Loading game…</span>
              <Skeleton height="12rem" />
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
// body, keyed off `match.status`. Keep this
// component thin — no game-specific logic belongs in MatchPage.
//
// `match` (the lobby summary) is still the source of `hostId`
// and `gameId`, neither of which appears in `MatchSnapshot` — they never
// change for the lifetime of a match, so there is no freshness concern in
// reading them from the one-shot `getMatch()` load. Everything that *does*
// change live (status, players, whose turn it is) is read from `snapshot`
// once it exists, falling back to `match`'s own copy before the first
// snapshot arrives.
function MatchBody({
  match,
  snapshot,
  events,
  transportError,
  send,
  start,
  myPlayerId,
}: {
  match: MatchSummary;
  snapshot: MatchSnapshot | null;
  events: MatchEvent[];
  transportError: MatchError | null;
  send: (action: unknown) => void;
  start: () => void;
  myPlayerId: string;
}) {
  const meta = getGameMeta(match.gameId);
  const status = snapshot?.status ?? match.status;
  const players = snapshot?.players ?? match.players;

  if (status === "lobby") {
    const isHost = myPlayerId === match.hostId;
    const count = players.length;
    const canStart =
      isHost && meta !== undefined && count >= meta.minPlayers && count <= meta.maxPlayers;

    return (
      <Card className="mb-4">
        <Card.Content className="gap-3">
          <Card.Title>Players</Card.Title>
          <Roster players={players} meta={meta} hostId={match.hostId} myPlayerId={myPlayerId} />
          {meta && (
            <p className="m-0 text-muted">
              {meta.name} needs {meta.minPlayers}
              {meta.maxPlayers !== meta.minPlayers ? `-${meta.maxPlayers}` : ""} players.
              {isHost ? "" : " Waiting for the host to start."}
            </p>
          )}
          {isHost && (
            <Button onPress={start} isDisabled={!canStart} className="self-start">
              Start match
            </Button>
          )}
          {transportError && (
            <Notice tone="danger" role="status">
              {transportError.message}
            </Notice>
          )}
        </Card.Content>
      </Card>
    );
  }

  // active / done — the game itself needs the live snapshot, which may
  // still be in flight for a brief instant right after the lobby summary
  // (loaded first) reports the match has already started elsewhere.
  if (!snapshot) {
    return <GameSurfaceSkeleton />;
  }

  return (
    <>
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
          {transportError.message}
        </Notice>
      )}
      <HistoryPanel events={events} />
    </>
  );
}

export function MatchPage({ code }: { code: string }) {
  const { player, notifyUnauthorized } = useSession();
  const [match, setMatch] = useState<MatchSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let result = await getMatch(code);
      // A visitor who landed here via the shared "Copy link" URL (rather
      // than the dashboard's "Join a match" form) has never called
      // `/join` — reading the lobby doesn't require membership, but
      // rendering it as if they're in it would be misleading, and the live
      // transport's own /view check would 403 them as `not_a_player`. Join
      // on their behalf the first time they see a lobby they're not part of.
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
      if (err instanceof ApiError && err.status === 404) {
        setError("No match with that code.");
      } else if (err instanceof ApiError && err.status === 409) {
        setError(
          err.code === "lobby_full" ? "This lobby is full." : "This match has already started.",
        );
      } else {
        setError(err instanceof Error ? err.message : "Failed to load this match.");
      }
    } finally {
      setLoading(false);
    }
  }, [code, notifyUnauthorized, player]);

  useEffect(() => {
    load();
  }, [load]);

  const myPlayerId = player?.playerId ?? "";

  // Only open the live transport once `load()` has confirmed this player is
  // actually in the roster (joining them first if they arrived via a shared
  // link). Connecting any earlier races that join — see useMatch's own
  // comment on `ready` for why that race turns into a permanent failure
  // rather than a transient one.
  const ready =
    !loading && !error && match !== null && match.players.some((p) => p.id === myPlayerId);

  const {
    snapshot,
    events,
    connection,
    error: transportError,
    send,
    start,
  } = useMatch(code, ready, notifyUnauthorized);

  // Tab badge: keep it live from this match's own snapshot
  // stream between dashboard visits — a WS push that makes it this player's
  // turn updates the badge immediately, rather than waiting for the next
  // time the dashboard is mounted/polled. `setDashboardYourTurn` (called
  // from Dashboard on every fetch) remains the authoritative resync.
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
      {match && (
        <MatchHeader
          name={meta?.name ?? match.gameId}
          status={status ?? match.status}
          connection={connection}
        />
      )}

      {loading && <MatchSkeleton />}

      {!loading && error && (
        <Notice tone="danger" action={{ label: "Retry", onClick: () => load() }}>
          {error}
        </Notice>
      )}

      {!loading && !error && match && (
        <>
          <ShareCode code={code} collapsed={status !== "lobby"} />
          <MatchBody
            match={match}
            snapshot={snapshot}
            events={events}
            transportError={transportError}
            send={send}
            start={start}
            myPlayerId={myPlayerId}
          />
        </>
      )}
    </main>
  );
}
