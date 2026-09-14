import { Component, Suspense, lazy, useCallback, useEffect, useState } from "react";
import type { ComponentType, LazyExoticComponent, ReactNode } from "react";

import { getGameMeta } from "../../games/catalog";
import { gameUi } from "../../games/registry";
import type { GameUiProps, MatchEvent, MatchSnapshot, MatchSummary } from "../../shared/protocol";
import { ApiError, getMatch, joinMatch } from "../api";
import { clearMatchWaiting, setMatchWaiting } from "../badge";
import { ConnectionBadge } from "../components/ConnectionBadge";
import { DebugGameView } from "../components/DebugGameView";
import { HistoryPanel } from "../components/HistoryPanel";
import { TurnIndicator } from "../components/TurnIndicator";
import { useSession } from "../session";
import type { ConnectionState, MatchError } from "../useMatch";
import { useMatch } from "../useMatch";

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}/m/${code}`;
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
    const input = document.getElementById("match-share-url") as HTMLInputElement | null;
    input?.select();
  }

  return (
    <div className="card">
      <div className="match-code">{code}</div>
      <input id="match-share-url" readOnly value={`${window.location.origin}/m/${code}`} />
      <button onClick={copy}>{copied ? "Copied!" : "Copy link"}</button>
    </div>
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

  const Lazy = getLazyUi(gameId);
  if (!Lazy) return <DebugGameView {...props} />;

  return (
    <GameErrorBoundary key={code} fallback={<DebugGameView {...props} />}>
      <Suspense fallback={<div className="card">Loading game…</div>}>
        <Lazy {...props} />
      </Suspense>
    </GameErrorBoundary>
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
  connection,
  transportError,
  send,
  start,
  myPlayerId,
}: {
  match: MatchSummary;
  snapshot: MatchSnapshot | null;
  events: MatchEvent[];
  connection: ConnectionState;
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
      <div className="card">
        <h2>Players</h2>
        <ul className="player-list">
          {players.map((p) => (
            <li key={p.id}>
              {p.nickname}
              {p.id === match.hostId && <span className="badge">host</span>}
              {p.id === myPlayerId && <span className="badge">you</span>}
            </li>
          ))}
        </ul>
        {meta && (
          <p>
            {meta.name} needs {meta.minPlayers}
            {meta.maxPlayers !== meta.minPlayers ? `-${meta.maxPlayers}` : ""} players.
            {isHost ? "" : " Waiting for the host to start."}
          </p>
        )}
        {isHost && (
          <button onClick={start} disabled={!canStart}>
            Start match
          </button>
        )}
        {transportError && <p className="error">{transportError.message}</p>}
      </div>
    );
  }

  // active / done — the game itself needs the live snapshot, which may
  // still be in flight for a brief instant right after the lobby summary
  // (loaded first) reports the match has already started elsewhere.
  if (!snapshot) {
    return (
      <div className="card">
        <p>Loading match…</p>
      </div>
    );
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
      {transportError && <p className="error">{transportError.message}</p>}
      <HistoryPanel events={events} />
      <div className="match-footer">
        <ConnectionBadge connection={connection} />
      </div>
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

  return (
    <main className="container">
      <CopyCode code={code} />

      {loading && <p>Loading…</p>}

      {!loading && error && (
        <div className="card">
          <p className="error">{error}</p>
          <button onClick={() => load()}>Retry</button>
        </div>
      )}

      {!loading && !error && match && (
        <>
          <div className="card">
            <p>
              Game: <strong>{meta?.name ?? match.gameId}</strong>
            </p>
            <p>
              Status: <strong>{snapshot?.status ?? match.status}</strong>
            </p>
          </div>
          <MatchBody
            match={match}
            snapshot={snapshot}
            events={events}
            connection={connection}
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
