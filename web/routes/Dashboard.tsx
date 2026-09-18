import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";

import { Button, FieldError, Form, Input, Tabs, TextField } from "@heroui/react";

import type { GameMeta } from "../../games/catalog";
import { normalizeMatchCode } from "../../shared/ids";
import type { MatchSummary } from "../../shared/protocol";
import { ApiError, createMatch, getGames, joinMatch, listMatches } from "../api";
import type { MatchBuckets } from "../api";
import { setDashboardYourTurn } from "../badge";
import { GameGlyph } from "../components/GameGlyph";
import { MatchCard } from "../components/MatchCard";
import { EmptyState, Notice, Skeleton } from "../components/states";
import { navigate } from "../router";
import { useSession } from "../session";

const POLL_MS = 30_000;

// Caps the stagger so a long list never ends up with a card that visibly
// waits a second before appearing.
const MAX_STAGGER_MS = 280;
const STAGGER_STEP_MS = 45;

function gameName(games: GameMeta[], gameId: string): string {
  return games.find((g) => g.id === gameId)?.name ?? gameId;
}

function playerRange(meta: GameMeta): string {
  return meta.minPlayers === meta.maxPlayers
    ? `${meta.minPlayers} players`
    : `${meta.minPlayers}–${meta.maxPlayers} players`;
}

// `.party-pop` reads its own delay from this custom property, so a grid can
// be staggered without a class per position.
function staggerStyle(index: number): CSSProperties {
  return {
    "--pop-delay": `${Math.min(index * STAGGER_STEP_MS, MAX_STAGGER_MS)}ms`,
  } as CSSProperties;
}

// One game on the shelf. The whole tile is the button — pressing it creates
// a match and goes straight to its lobby, so starting a game is one tap
// rather than a form. A `comingSoon` game keeps its tile, drained of colour
// and permanently disabled, so the shelf still shows what is on the way.
function GameTile({
  meta,
  index,
  busy,
  disabled,
  onPlay,
}: {
  meta: GameMeta;
  index: number;
  busy: boolean;
  disabled: boolean;
  onPlay: () => void;
}) {
  const comingSoon = meta.comingSoon === true;
  return (
    <button
      type="button"
      onClick={onPlay}
      disabled={disabled || comingSoon}
      aria-label={
        comingSoon
          ? `${meta.name}, coming soon`
          : `Start a new ${meta.name} match, ${playerRange(meta)}`
      }
      style={staggerStyle(index)}
      className={`party-pop group relative flex cursor-pointer flex-col items-start gap-3 overflow-hidden rounded-[var(--radius-xl)] border-2 border-[var(--border-subtle)] bg-[var(--surface-1)] p-5 text-left shadow-[var(--shadow-2),var(--edge-highlight)] transition-[transform,box-shadow,border-color] duration-[var(--dur-base)] ease-[var(--ease-spring)] disabled:cursor-not-allowed disabled:opacity-60 not-disabled:hover:-translate-y-1.5 not-disabled:hover:border-[var(--border-accent)] not-disabled:hover:shadow-[var(--shadow-3),var(--glow-accent)] not-disabled:active:translate-y-0 not-disabled:active:scale-[0.98] ${
        comingSoon ? "border-dashed grayscale" : ""
      }`}
    >
      <GameGlyph
        gameId={meta.id}
        className={
          comingSoon
            ? "size-14"
            : "size-14 transition-transform duration-[var(--dur-base)] ease-[var(--ease-bounce)] group-hover:-rotate-12 group-hover:scale-110"
        }
      />
      <div className="flex flex-col gap-0.5">
        <span className="font-display text-lg font-bold text-[var(--text-primary)]">
          {meta.name}
        </span>
        <span className="text-sm text-[var(--text-muted)]">{playerRange(meta)}</span>
      </div>
      {comingSoon ? (
        <span
          aria-hidden="true"
          className="mt-1 inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] px-3 py-1.5 text-sm font-bold text-[var(--text-secondary)]"
        >
          Coming soon
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="mt-1 inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-3 py-1.5 text-sm font-bold transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] group-hover:scale-105"
          style={{ background: "var(--accent-soft)", color: "var(--accent-on-soft)" }}
        >
          {busy ? "Starting…" : "▸ Play"}
        </span>
      )}
    </button>
  );
}

// The tile after the playable games: the same footprint as a game, but it
// takes a code from someone else's invite instead of starting something new.
function JoinTile({
  index,
  code,
  onCodeChange,
  onSubmit,
  joining,
  error,
}: {
  index: number;
  code: string;
  onCodeChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  joining: boolean;
  error: string | null;
}) {
  return (
    <div
      style={staggerStyle(index)}
      className="party-pop flex flex-col gap-3 rounded-[var(--radius-xl)] border-2 border-dashed border-[var(--border-subtle)] bg-[var(--surface-1)]/60 p-5"
    >
      <span
        aria-hidden="true"
        className="flex size-14 flex-none items-center justify-center rounded-[var(--radius-md)] border-2 border-dashed border-[var(--border-strong)] font-display text-2xl text-[var(--text-muted)]"
      >
        #
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="font-display text-lg font-bold text-[var(--text-primary)]">
          Got a code?
        </span>
        <span className="text-sm text-[var(--text-muted)]">Join a coworker&apos;s match</span>
      </div>
      <Form onSubmit={onSubmit} className="mt-1 flex w-full flex-col gap-2">
        <TextField
          value={code}
          onChange={onCodeChange}
          isInvalid={!!error}
          className="w-full"
          aria-label="Match code"
        >
          <div className="flex items-center gap-2">
            <Input
              placeholder="AB23CD"
              maxLength={12}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="w-full min-w-0 text-center font-mono text-base tracking-[0.25em] uppercase"
            />
            <Button
              type="submit"
              size="sm"
              isDisabled={joining}
              className="flex-none rounded-[var(--radius-pill)] font-bold"
            >
              {joining ? "…" : "Join"}
            </Button>
          </div>
          {error && <FieldError>{error}</FieldError>}
        </TextField>
      </Form>
    </div>
  );
}

function Bucket({
  matches,
  games,
  myPlayerId,
  accent,
  emptyText,
  emptyGlyph,
}: {
  matches: MatchSummary[];
  games: GameMeta[];
  myPlayerId: string;
  accent?: boolean;
  emptyText: string;
  emptyGlyph?: string;
}) {
  if (matches.length === 0) {
    return <EmptyState glyph={emptyGlyph}>{emptyText}</EmptyState>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {matches.map((m, i) => (
        <MatchCard
          key={m.id}
          match={m}
          gameName={gameName(games, m.gameId)}
          myPlayerId={myPlayerId}
          accent={accent}
          style={staggerStyle(i)}
        />
      ))}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <Skeleton width="14rem" height="2.5rem" className="mb-6" rounded="lg" />
      <Skeleton width="7rem" height="1.2rem" className="mb-3" rounded="pill" />
      <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton height="14rem" rounded="xl" />
        <Skeleton height="14rem" rounded="xl" />
        <Skeleton height="14rem" rounded="xl" />
      </div>
      <Skeleton width="9rem" height="1.2rem" className="mb-3" rounded="pill" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Skeleton height="7rem" rounded="lg" />
        <Skeleton height="7rem" rounded="lg" />
      </div>
    </>
  );
}

type BucketKey = "yourTurn" | "waiting" | "finished";

const BUCKET_TABS: { key: BucketKey; label: string; empty: string; glyph: string }[] = [
  {
    key: "yourTurn",
    label: "Your turn",
    empty: "Nothing needs your move right now. Start something above.",
    glyph: "✦",
  },
  {
    key: "waiting",
    label: "Their turn",
    empty: "No matches waiting on someone else.",
    glyph: "⏳",
  },
  { key: "finished", label: "Finished", empty: "No finished matches yet.", glyph: "🏁" },
];

export function Dashboard() {
  const { player, notifyUnauthorized } = useSession();
  const [buckets, setBuckets] = useState<MatchBuckets | null>(null);
  const [games, setGames] = useState<GameMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const [tab, setTab] = useState<BucketKey>("yourTurn");
  // The opening tab is chosen once, from the first load that returns
  // anything: someone with nothing to play but three games in flight should
  // land on a populated tab. Later polls must not move it under them.
  const pickedOpeningTab = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [nextBuckets, nextGames] = await Promise.all([listMatches(), getGames()]);
      setBuckets(nextBuckets);
      setGames(nextGames);
      setError(null);
      // The tab badge: the dashboard's "your turn" bucket is the full,
      // authoritative set of matches awaiting this player.
      setDashboardYourTurn(nextBuckets.yourTurn.map((m) => m.id));
      if (!pickedOpeningTab.current) {
        pickedOpeningTab.current = true;
        const firstFilled = BUCKET_TABS.find((t) => nextBuckets[t.key].length > 0);
        if (firstFilled) setTab(firstFilled.key);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        notifyUnauthorized();
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load matches.");
    } finally {
      setLoading(false);
    }
  }, [notifyUnauthorized]);

  // A return to / must show fresh buckets. There is no cache to invalidate
  // for that — this component holds no state across mounts, and App.tsx's
  // route switch unmounts it entirely whenever the route is not "dashboard"
  // (see RouteContent). Every navigation back to `/` therefore mounts a
  // brand new Dashboard, which this effect refetches from scratch —
  // "refetch on route change to /" is already what happens, with no extra
  // plumbing needed.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Refresh on tab focus and on a 30s poll while the tab is visible. This is
  // browser-side setInterval, not a Durable Object timer — the ban on
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

  async function handlePlay(gameId: string) {
    if (creatingId) return;
    setCreatingId(gameId);
    setCreateError(null);
    try {
      const { code } = await createMatch(gameId);
      navigate(`/m/${code}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        notifyUnauthorized();
        return;
      }
      setCreateError(err instanceof Error ? err.message : "Could not create the match.");
    } finally {
      setCreatingId(null);
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
  const turnCount = data.yourTurn.length;
  // Coming-soon games go at the very end, after the join tile, so every
  // tile that does something sits together at the front of the shelf.
  const playable = games.filter((g) => !g.comingSoon);
  const comingSoon = games.filter((g) => g.comingSoon);

  return (
    <main id="main-content" className="app-container">
      <section className="party-pop mb-9">
        <h1 className="m-0 font-display text-3xl font-bold tracking-tight text-balance text-[var(--text-primary)] sm:text-4xl">
          Hey {player?.nickname ?? "there"} 👋
        </h1>
        <p className="mt-2 mb-0 text-[var(--text-secondary)]">
          {turnCount > 0
            ? `${turnCount} ${turnCount === 1 ? "match needs" : "matches need"} your move.`
            : "Nothing needs your move. Pick a game and start one."}
        </p>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 font-display text-sm font-bold tracking-[0.15em] text-[var(--text-muted)] uppercase">
          Pick a game
        </h2>
        {createError && (
          <div className="mb-3">
            <Notice tone="danger">{createError}</Notice>
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {playable.map((g, i) => (
            <GameTile
              key={g.id}
              meta={g}
              index={i}
              busy={creatingId === g.id}
              disabled={creatingId !== null}
              onPlay={() => handlePlay(g.id)}
            />
          ))}
          <JoinTile
            index={playable.length}
            code={joinCode}
            // The error clears on every edit: while the field is `isInvalid`, the browser
            // refuses to submit the form, so a mistyped code could never be corrected.
            onCodeChange={(value) => {
              setJoinCode(value);
              setJoinError(null);
            }}
            onSubmit={handleJoin}
            joining={joining}
            error={joinError}
          />
          {comingSoon.map((g, i) => (
            <GameTile
              key={g.id}
              meta={g}
              index={playable.length + 1 + i}
              busy={false}
              disabled
              onPlay={() => {}}
            />
          ))}
        </div>
      </section>

      <section>
        <Tabs
          selectedKey={tab}
          onSelectionChange={(key) => setTab(key as BucketKey)}
          className="w-full"
        >
          {/* The width overrides below undo HeroUI's own `min-w-full` on the
              list and `w-full` on each tab, which would otherwise stretch
              this pill across the whole page. */}
          <Tabs.ListContainer className="w-fit max-w-full self-start bg-transparent">
            <Tabs.List
              aria-label="Your matches"
              className="w-fit min-w-0 rounded-[var(--radius-pill)] border border-[var(--border-subtle)] bg-[var(--surface-2)] p-1"
            >
              {BUCKET_TABS.map((t) => (
                <Tabs.Tab
                  key={t.key}
                  id={t.key}
                  className="w-auto gap-2 rounded-[var(--radius-pill)]"
                >
                  {t.label}
                  <span className="text-xs font-bold opacity-70">{data[t.key].length}</span>
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>
          {BUCKET_TABS.map((t) => (
            <Tabs.Panel key={t.key} id={t.key} className="pt-5">
              <Bucket
                matches={data[t.key]}
                games={games}
                myPlayerId={myPlayerId}
                accent={t.key === "yourTurn"}
                emptyText={t.empty}
                emptyGlyph={t.glyph}
              />
            </Tabs.Panel>
          ))}
        </Tabs>
      </section>
    </main>
  );
}
