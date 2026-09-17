import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";

import {
  Button,
  Card,
  Chip,
  FieldError,
  Form,
  Input,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from "@heroui/react";

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

function statusChipColor(status: MatchStatus): "accent" | "success" | "default" {
  if (status === "lobby") return "accent";
  if (status === "active") return "success";
  return "default";
}

function MatchRow({
  match,
  games,
  myPlayerId,
  accent,
  style,
}: {
  match: MatchSummary;
  games: GameMeta[];
  myPlayerId: string;
  accent?: boolean;
  style?: CSSProperties;
}) {
  const others = match.players.filter((p) => p.id !== myPlayerId);
  const otherNames =
    others.length > 0 ? others.map((p) => p.nickname).join(", ") : "waiting for others to join";
  return (
    <a
      className={`group flex animate-in fade-in slide-in-from-bottom-2 flex-col gap-2 rounded-lg border bg-surface p-4 no-underline shadow-[var(--edge-highlight),var(--shadow-2)] duration-500 fill-mode-both transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--edge-highlight),var(--shadow-3)] ${
        accent
          ? "border-[var(--border-accent)] shadow-[var(--edge-highlight),var(--shadow-2),var(--glow-accent)]"
          : "border-border"
      }`}
      href={`/m/${match.id}`}
      style={style}
      onClick={(e) => {
        e.preventDefault();
        navigate(`/m/${match.id}`);
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-foreground">{gameName(games, match.gameId)}</strong>
        <Chip size="sm" color={statusChipColor(match.status)}>
          {match.status}
        </Chip>
      </div>
      <span className="text-muted">{otherNames}</span>
      <div className="flex gap-3 text-xs text-muted">
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
    <section className="mb-8 animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="m-0 text-lg font-semibold text-foreground">{title}</h2>
        <Chip size="sm">{matches.length}</Chip>
      </div>
      {matches.length === 0 ? (
        <EmptyState>{emptyText}</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
          {matches.map((m, i) => (
            <MatchRow
              key={m.id}
              match={m}
              games={games}
              myPlayerId={myPlayerId}
              accent={accent}
              style={{ animationDelay: `${Math.min(i * 40, 320)}ms` }}
            />
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
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <Skeleton width="8rem" height="1.3rem" />
        <Skeleton width="2rem" height="1.3rem" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
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

function GameTile({ meta, hue }: { meta: GameMeta; hue: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-10 items-center justify-center rounded-md text-lg font-bold"
      style={{ backgroundColor: `hsl(${hue} 70% 45%)`, color: "var(--accent-contrast)" }}
    >
      {meta.name.charAt(0).toUpperCase()}
    </span>
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
      <main id="main-content" className="app-container">
        <DashboardSkeleton />
      </main>
    );
  }

  if (error) {
    return (
      <main id="main-content" className="app-container">
        <Notice tone="danger" action={{ label: "Retry", onClick: () => refresh() }}>
          {error}
        </Notice>
      </main>
    );
  }

  const myPlayerId = player?.playerId ?? "";
  const data = buckets ?? { yourTurn: [], waiting: [], finished: [] };

  return (
    <main id="main-content" className="app-container">
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

      <Card className="mb-4 border-[var(--border-accent)] shadow-[var(--edge-highlight),var(--shadow-2),var(--glow-accent)]">
        <Card.Content className="flex flex-col gap-3">
          <Card.Title>Start a new match</Card.Title>
          <Form onSubmit={handleCreate} className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-muted">Game</span>
              <ToggleButtonGroup
                aria-label="Game"
                selectionMode="single"
                disallowEmptySelection
                selectedKeys={selectedGame ? [selectedGame] : []}
                onSelectionChange={(keys) => {
                  const next = [...keys][0] as string | undefined;
                  if (next) setSelectedGame(next);
                }}
                className="grid grid-cols-2 gap-2 sm:grid-cols-3"
              >
                {games.map((g) => (
                  <ToggleButton
                    key={g.id}
                    id={g.id}
                    aria-label={`${g.name}, ${playerRange(g)}`}
                    className="flex h-auto flex-col items-center gap-1 p-3 text-center"
                  >
                    <GameTile meta={g} hue={hueForId(g.id)} />
                    <span className="font-semibold">{g.name}</span>
                    <span className="text-xs text-muted">{playerRange(g)}</span>
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </div>
            {createError && (
              <p role="alert" className="m-0 text-sm text-danger">
                {createError}
              </p>
            )}
            <Button type="submit" isDisabled={creating || !selectedGame}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </Form>
        </Card.Content>
      </Card>

      <Card className="mb-4">
        <Card.Content className="flex flex-col gap-3">
          <Card.Title>Join a match</Card.Title>
          <Form onSubmit={handleJoin} className="flex flex-col gap-3">
            <TextField value={joinCode} onChange={setJoinCode} isInvalid={!!joinError}>
              <label className="text-sm font-semibold text-muted" htmlFor="join-code">
                Match code
              </label>
              <div className="flex items-start gap-2">
                <Input
                  id="join-code"
                  className="flex-1 font-mono tracking-[0.2em] uppercase"
                  placeholder="e.g. AB23CD"
                />
                <Button type="submit" variant="ghost" isDisabled={joining}>
                  {joining ? "Joining…" : "Join"}
                </Button>
              </div>
              {joinError && <FieldError>{joinError}</FieldError>}
            </TextField>
          </Form>
        </Card.Content>
      </Card>
    </main>
  );
}
