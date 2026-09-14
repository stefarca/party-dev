import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";

import type { GameMeta } from "../../games/catalog";
import { normalizeMatchCode } from "../../shared/ids";
import type { MatchStatus, MatchSummary } from "../../shared/protocol";
import { ApiError, createMatch, getGames, joinMatch, listMatches } from "../api";
import type { MatchBuckets } from "../api";
import { setDashboardYourTurn } from "../badge";
import { EmptyState, Notice, Skeleton } from "../components/states";
import { formatDeadline, relativeTime } from "../format";
import { navigate } from "../router";
import { useSession } from "../session";

const POLL_MS = 30_000;

function gameName(games: GameMeta[], gameId: string): string {
  return games.find((g) => g.id === gameId)?.name ?? gameId;
}

// A deterministic, game-agnostic hue derived from the id string — never a
// hardcoded per-game colour or asset.
function hueForId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

function playerRange(meta: GameMeta): string {
  return meta.minPlayers === meta.maxPlayers
    ? `${meta.minPlayers} players`
    : `${meta.minPlayers}-${meta.maxPlayers} players`;
}

function statusChipClass(status: MatchStatus): string {
  if (status === "lobby") return "chip chip-accent";
  if (status === "active") return "chip chip-ok";
  return "chip";
}

function MatchRow({
  match,
  games,
  myPlayerId,
  accent,
}: {
  match: MatchSummary;
  games: GameMeta[];
  myPlayerId: string;
  accent?: boolean;
}) {
  const others = match.players.filter((p) => p.id !== myPlayerId);
  const otherNames =
    others.length > 0 ? others.map((p) => p.nickname).join(", ") : "waiting for others to join";
  return (
    <a
      className={`panel match-card${accent ? " match-card-accent" : ""}`}
      href={`/m/${match.id}`}
      onClick={(e) => {
        e.preventDefault();
        navigate(`/m/${match.id}`);
      }}
    >
      <div className="match-card-main">
        <strong>{gameName(games, match.gameId)}</strong>
        <span className={statusChipClass(match.status)}>{match.status}</span>
      </div>
      <span className="match-card-players">{otherNames}</span>
      <div className="match-card-meta">
        <span>{relativeTime(match.updatedAt)}</span>
        {match.deadline !== null && <span>{formatDeadline(match.deadline)}</span>}
      </div>
    </a>
  );
}

function Section({
  title,
  emptyText,
  matches,
  games,
  myPlayerId,
  accent,
}: {
  title: string;
  emptyText: string;
  matches: MatchSummary[];
  games: GameMeta[];
  myPlayerId: string;
  accent?: boolean;
}) {
  return (
    <section className="shelf">
      <div className="shelf-header">
        <h2 className="shelf-title">{title}</h2>
        <span className="chip">{matches.length}</span>
      </div>
      {matches.length === 0 ? (
        <EmptyState>{emptyText}</EmptyState>
      ) : (
        <div className="match-list">
          {matches.map((m) => (
            <MatchRow key={m.id} match={m} games={games} myPlayerId={myPlayerId} accent={accent} />
          ))}
        </div>
      )}
    </section>
  );
}

// Reserves roughly the shelf/match-card footprint the real content will
// take, so the first fetch doesn't cause a layout jump when it resolves.
function ShelfSkeleton() {
  return (
    <section className="shelf">
      <div className="shelf-header">
        <Skeleton width="8rem" height="1.3rem" />
        <Skeleton width="2rem" height="1.3rem" />
      </div>
      <div className="match-list">
        <Skeleton height="6.5rem" />
        <Skeleton height="6.5rem" />
      </div>
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <ShelfSkeleton />
      <ShelfSkeleton />
      <ShelfSkeleton />
    </>
  );
}

export function Dashboard() {
  const { player, notifyUnauthorized } = useSession();
  const [buckets, setBuckets] = useState<MatchBuckets | null>(null);
  const [games, setGames] = useState<GameMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedGame, setSelectedGame] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextBuckets, nextGames] = await Promise.all([listMatches(), getGames()]);
      setBuckets(nextBuckets);
      setGames(nextGames);
      setError(null);
      // The tab badge: the dashboard's "your turn" bucket is the
      // full, authoritative set of matches awaiting this player.
      setDashboardYourTurn(nextBuckets.yourTurn.map((m) => m.id));
      if (!selectedGame && nextGames.length > 0) setSelectedGame(nextGames[0].id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        notifyUnauthorized();
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load matches.");
    } finally {
      setLoading(false);
    }
    // selectedGame is intentionally excluded: it is set *from* this effect
    // as a default and must not retrigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifyUnauthorized]);

  // A return to / must show fresh buckets. There is no cache to invalidate
  // for that — this component
  // holds no state across mounts, and App.tsx's route switch unmounts it
  // entirely whenever the route is not "dashboard" (see RouteContent). Every
  // navigation back to `/` therefore mounts a brand new Dashboard, which
  // this effect refetches from scratch — "refetch on route change to /" is
  // already what happens, with no extra plumbing needed.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Refresh on tab focus and on a 30s poll while the tab is visible. This
  // is browser-side setInterval, not a Durable Object timer — the ban on
  // setInterval is scoped to DOs (they must use ctx.storage.setAlarm()
  // instead); a plain browser tab has no such constraint.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    function scheduleNext() {
      timerRef.current = setTimeout(() => {
        if (!document.hidden) refresh();
        scheduleNext();
      }, POLL_MS);
    }
    scheduleNext();
    function onFocus() {
      refresh();
    }
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [refresh]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!selectedGame) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { code } = await createMatch(selectedGame);
      navigate(`/m/${code}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        notifyUnauthorized();
        return;
      }
      setCreateError(err instanceof Error ? err.message : "Could not create the match.");
    } finally {
      setCreating(false);
    }
  }

  async function handleJoin(e: FormEvent) {
    e.preventDefault();
    const code = normalizeMatchCode(joinCode);
    if (!code) {
      setJoinError("Enter a match code.");
      return;
    }
    setJoining(true);
    setJoinError(null);
    try {
      await joinMatch(code);
      navigate(`/m/${code}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        notifyUnauthorized();
        return;
      }
      if (err instanceof ApiError && err.status === 404) {
        setJoinError("No match with that code.");
      } else {
        setJoinError(err instanceof Error ? err.message : "Could not join that match.");
      }
    } finally {
      setJoining(false);
    }
  }

  if (loading) {
    return (
      <main id="main-content" className="page">
        <DashboardSkeleton />
      </main>
    );
  }

  if (error) {
    return (
      <main id="main-content" className="page">
        <Notice tone="danger" action={{ label: "Retry", onClick: () => refresh() }}>
          {error}
        </Notice>
      </main>
    );
  }

  const myPlayerId = player?.playerId ?? "";
  const data = buckets ?? { yourTurn: [], waiting: [], finished: [] };

  return (
    <main id="main-content" className="page">
      <Section
        title="Your turn"
        emptyText="Nothing needs your move right now."
        matches={data.yourTurn}
        games={games}
        myPlayerId={myPlayerId}
        accent
      />
      <Section
        title="Waiting on others"
        emptyText="No matches waiting on someone else."
        matches={data.waiting}
        games={games}
        myPlayerId={myPlayerId}
      />
      <Section
        title="Finished"
        emptyText="No finished matches yet."
        matches={data.finished}
        games={games}
        myPlayerId={myPlayerId}
      />

      <section className="panel panel-accent">
        <div className="panel-header">
          <h2>Start a new match</h2>
        </div>
        <div className="panel-body">
          <form onSubmit={handleCreate} className="stack">
            <fieldset className="game-picker">
              <legend>Game</legend>
              {games.map((g) => {
                const hue = hueForId(g.id);
                return (
                  <label key={g.id} className="game-picker-option">
                    <input
                      type="radio"
                      name="game"
                      className="game-picker-input"
                      value={g.id}
                      checked={selectedGame === g.id}
                      onChange={() => setSelectedGame(g.id)}
                    />
                    <span className="game-picker-card">
                      <span
                        className="game-tile"
                        style={{ "--tile-hue": hue } as CSSProperties}
                        aria-hidden="true"
                      >
                        {g.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="game-picker-name">{g.name}</span>
                      <span className="game-picker-range">{playerRange(g)}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            {createError && <p className="error">{createError}</p>}
            <button type="submit" className="btn btn-primary" disabled={creating || !selectedGame}>
              {creating ? "Creating…" : "Create"}
            </button>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Join a match</h2>
        </div>
        <div className="panel-body">
          <form onSubmit={handleJoin} className="stack">
            <label htmlFor="join-code">Match code</label>
            <div className="join-form-row">
              <input
                id="join-code"
                className="input-code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="e.g. AB23CD"
              />
              <button type="submit" className="btn btn-ghost" disabled={joining}>
                {joining ? "Joining…" : "Join"}
              </button>
            </div>
            {joinError && <p className="error">{joinError}</p>}
          </form>
        </div>
      </section>
    </main>
  );
}
