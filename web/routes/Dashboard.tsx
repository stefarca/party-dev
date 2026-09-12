import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import type { GameMeta } from "../../games/catalog";
import { normalizeMatchCode } from "../../shared/ids";
import type { MatchSummary } from "../../shared/protocol";
import { ApiError, createMatch, getGames, joinMatch, listMatches } from "../api";
import type { MatchBuckets } from "../api";
import { formatDeadline, relativeTime } from "../format";
import { navigate } from "../router";
import { useSession } from "../session";

const POLL_MS = 30_000;

function gameName(games: GameMeta[], gameId: string): string {
  return games.find((g) => g.id === gameId)?.name ?? gameId;
}

function MatchRow({ match, games, myPlayerId }: { match: MatchSummary; games: GameMeta[]; myPlayerId: string }) {
  const others = match.players.filter((p) => p.id !== myPlayerId);
  const otherNames = others.length > 0 ? others.map((p) => p.nickname).join(", ") : "waiting for others to join";
  return (
    <a className="card match-row" href={`/m/${match.id}`} onClick={(e) => { e.preventDefault(); navigate(`/m/${match.id}`); }}>
      <div className="match-row-main">
        <strong>{gameName(games, match.gameId)}</strong>
        <span className="match-row-players">{otherNames}</span>
      </div>
      <div className="match-row-meta">
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
    <section className={accent ? "your-turn" : undefined}>
      <h2>
        {title}
        {matches.length > 0 ? ` (${matches.length})` : ""}
      </h2>
      {matches.length === 0 ? (
        <p className="empty-state">{emptyText}</p>
      ) : (
        <div className="match-list">
          {matches.map((m) => (
            <MatchRow key={m.id} match={m} games={games} myPlayerId={myPlayerId} />
          ))}
        </div>
      )}
    </section>
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

  // Plan 05 step 8 ("invalidate the cached dashboard list so a return to /
  // shows fresh buckets"): there is no cache to invalidate — this component
  // holds no state across mounts, and App.tsx's route switch unmounts it
  // entirely whenever the route is not "dashboard" (see RouteContent). Every
  // navigation back to `/` therefore mounts a brand new Dashboard, which
  // this effect refetches from scratch — "refetch on route change to /" is
  // already what happens, with no extra plumbing needed.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Refresh on tab focus and on a 30s poll while the tab is visible. This
  // is browser-side setInterval, not a Durable Object timer — the PLAN.md
  // §10.4 ban on setInterval is scoped to DOs (they must use
  // ctx.storage.setAlarm() instead); a plain browser tab has no such
  // constraint, and plan 05 replaces this polling with live updates anyway.
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
      <main className="container">
        <p>Loading…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="container">
        <p className="error">{error}</p>
        <button onClick={() => refresh()}>Retry</button>
      </main>
    );
  }

  const myPlayerId = player?.playerId ?? "";
  const data = buckets ?? { yourTurn: [], waiting: [], finished: [] };

  return (
    <main className="container">
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

      <section className="card">
        <h2>Start a new match</h2>
        <form onSubmit={handleCreate}>
          <label htmlFor="game-select">Game</label>
          <select id="game-select" value={selectedGame} onChange={(e) => setSelectedGame(e.target.value)}>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.minPlayers}-{g.maxPlayers} players)
              </option>
            ))}
          </select>
          {createError && <p className="error">{createError}</p>}
          <button type="submit" disabled={creating || !selectedGame}>
            {creating ? "Creating…" : "Create"}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Join a match</h2>
        <form onSubmit={handleJoin}>
          <label htmlFor="join-code">Match code</label>
          <input
            id="join-code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="e.g. AB23CD"
          />
          {joinError && <p className="error">{joinError}</p>}
          <button type="submit" disabled={joining}>
            {joining ? "Joining…" : "Join"}
          </button>
        </form>
      </section>
    </main>
  );
}
