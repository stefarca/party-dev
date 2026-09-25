import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";

import { Button, FieldError, Form, Input, Tabs, TextField } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { getDailyMeta } from "../../games/catalog";
import type { GameMeta } from "../../games/catalog";
import { normalizeMatchCode } from "../../shared/ids";
import type { DailyHub, MatchSummary, MatchVisibility, PlayerStreaks } from "../../shared/protocol";
import { ApiError, createMatch, getDailyHub, getGames, joinMatch, listMatches } from "../api";
import type { MatchBuckets } from "../api";
import { setDashboardYourTurn } from "../badge";
import { DailyTile } from "../components/DailyTile";
import { GameGlyph } from "../components/GameGlyph";
import { InstallPrompt } from "../components/InstallPrompt";
import { MatchCard } from "../components/MatchCard";
import { EmptyState, Notice, Skeleton } from "../components/states";
import { VisibilitySwitch } from "../components/VisibilitySwitch";
import { errorText } from "../errors";
import { playerRange, relativeTime } from "../format";
import { useGameName, useLanguage } from "../i18n";
import { HUB_TABS, navigate } from "../router";
import type { HubTab } from "../router";
import { useSession } from "../session";

const POLL_MS = 8_000;

// Caps the stagger so a long list never ends up with a card that visibly
// waits a second before appearing.
const MAX_STAGGER_MS = 280;
const STAGGER_STEP_MS = 45;

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
//
// On a phone the tiles are rows, two to a line, so the whole shelf and the
// code box fit on one screen. The pill under the name only repeats what
// pressing the tile does, so it waits for the room `sm` gives it, and until
// then the line under the name says whatever the pill would have.
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
  const { t } = useTranslation();
  const name = useGameName()(meta.id, meta.name);
  const comingSoon = meta.comingSoon === true;
  const players = playerRange(t, meta);
  let note = players;
  if (comingSoon) note = t("tile.comingSoon");
  else if (busy) note = t("tile.starting");
  return (
    <button
      type="button"
      onClick={onPlay}
      disabled={disabled || comingSoon}
      aria-label={
        comingSoon
          ? t("tile.comingSoonLabel", { game: name })
          : t("tile.start", { game: name, players })
      }
      style={staggerStyle(index)}
      className={`party-pop group relative flex min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-[var(--radius-lg)] border-2 border-[var(--border-subtle)] bg-[var(--surface-1)] p-2.5 text-left shadow-[var(--shadow-2),var(--edge-highlight)] transition-[transform,box-shadow,border-color] duration-[var(--dur-base)] ease-[var(--ease-spring)] disabled:cursor-not-allowed disabled:opacity-60 not-disabled:hover:-translate-y-1.5 not-disabled:hover:border-[var(--border-accent)] not-disabled:hover:shadow-[var(--shadow-3),var(--glow-accent)] not-disabled:active:translate-y-0 not-disabled:active:scale-[0.98] sm:flex-col sm:items-start sm:gap-3 sm:rounded-[var(--radius-xl)] sm:p-5 ${
        comingSoon ? "border-dashed grayscale" : ""
      }`}
    >
      <GameGlyph
        gameId={meta.id}
        className={
          comingSoon
            ? "size-10 sm:size-14"
            : "size-10 transition-transform duration-[var(--dur-base)] ease-[var(--ease-bounce)] group-hover:-rotate-12 group-hover:scale-110 sm:size-14"
        }
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-display text-sm leading-tight font-bold text-[var(--text-primary)] sm:text-lg">
          {name}
        </span>
        <span className="text-xs text-[var(--text-muted)] sm:text-sm">
          <span className="sm:hidden">{note}</span>
          <span className="hidden sm:inline">{players}</span>
        </span>
      </div>
      {comingSoon ? (
        <span
          aria-hidden="true"
          className="mt-1 hidden items-center gap-1.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] px-3 py-1.5 text-sm font-bold text-[var(--text-secondary)] sm:inline-flex"
        >
          {t("tile.comingSoon")}
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="mt-1 hidden items-center gap-1.5 rounded-[var(--radius-pill)] px-3 py-1.5 text-sm font-bold transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] group-hover:scale-105 sm:inline-flex"
          style={{ background: "var(--accent-soft)", color: "var(--accent-on-soft)" }}
        >
          {busy ? t("tile.starting") : t("tile.play")}
        </span>
      )}
    </button>
  );
}

// Under the shelf: a code from someone else's invite, instead of starting
// something new. One row on every screen, since the field is all it needs.
function JoinStrip({
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
  const { t } = useTranslation();
  return (
    <div
      style={staggerStyle(index)}
      className="party-pop mt-3 flex items-center gap-3 rounded-[var(--radius-lg)] border-2 border-dashed border-[var(--border-subtle)] bg-[var(--surface-1)]/60 p-3 sm:mt-4 sm:gap-4 sm:p-4"
    >
      <span
        aria-hidden="true"
        className="hidden size-12 flex-none items-center justify-center rounded-[var(--radius-md)] border-2 border-dashed border-[var(--border-strong)] font-display text-xl text-[var(--text-muted)] sm:flex"
      >
        #
      </span>
      <div className="flex flex-none flex-col">
        <span className="font-display text-sm font-bold text-[var(--text-primary)] sm:text-base">
          {t("join.title")}
        </span>
        <span className="hidden text-sm text-[var(--text-muted)] sm:block">
          {t("join.subtitle")}
        </span>
      </div>
      <Form onSubmit={onSubmit} className="min-w-0 flex-1">
        <TextField
          value={code}
          onChange={onCodeChange}
          isInvalid={!!error}
          className="w-full"
          aria-label={t("join.label")}
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
              {joining ? "…" : t("join.submit")}
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
  callToAction,
  emptyText,
  emptyGlyph,
}: {
  matches: MatchSummary[];
  games: GameMeta[];
  myPlayerId: string;
  accent?: boolean;
  callToAction?: string;
  emptyText: string;
  emptyGlyph?: string;
}) {
  const gameName = useGameName();
  if (matches.length === 0) {
    return <EmptyState glyph={emptyGlyph}>{emptyText}</EmptyState>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {matches.map((m, i) => (
        <MatchCard
          key={m.id}
          match={m}
          gameName={gameName(m.gameId, games.find((g) => g.id === m.gameId)?.name)}
          myPlayerId={myPlayerId}
          accent={accent}
          callToAction={callToAction}
          style={staggerStyle(i)}
        />
      ))}
    </div>
  );
}

// Which section is still unknown while this shows, so it stands in for the
// greeting and a few tiles' worth of any of them.
function DashboardSkeleton() {
  return (
    <>
      <Skeleton width="14rem" height="2.25rem" className="mb-3" rounded="lg" />
      <Skeleton width="10rem" height="1.2rem" className="mb-6" rounded="pill" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 sm:h-56" rounded="lg" />
        ))}
      </div>
    </>
  );
}

// Under the greeting on every section: what waits on the player, then the
// streaks, since they are what brings a player back. While today still has to
// be played for the play streak, its flame goes grey and it says so, the way a
// streak app nags. A win streak shows only once it is a streak. The record
// itself, and the breakdowns — by game, by opponent — are on the stats page it
// links to. All of it wraps as one row, so the pills share a line with the
// sentence whenever there is room.
function StatusRow({ movesNeeded, streaks }: { movesNeeded: number; streaks: PlayerStreaks }) {
  const { t } = useTranslation();
  const { play, wins } = streaks;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2 sm:mt-2">
      <p className="m-0 text-sm text-[var(--text-secondary)] sm:text-base">
        {movesNeeded > 0 ? t("hub.movesNeeded", { count: movesNeeded }) : t("hub.noMovesNeeded")}
      </p>
      {play.current > 0 && (
        <p
          className={`m-0 flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 py-1 text-xs ${
            play.today
              ? "border-[var(--warn-border)] bg-[var(--warn-soft)]"
              : "border-dashed border-[var(--warn-border)] bg-[var(--surface-1)]"
          }`}
        >
          <span aria-hidden="true" className={`text-base ${play.today ? "" : "grayscale"}`}>
            🔥
          </span>
          <span className="font-display text-sm font-bold text-[var(--text-primary)]">
            {t("hub.stats.playStreak", { count: play.current })}
          </span>
          {!play.today && (
            <span className="font-bold text-[var(--warn-fg)]">{t("hub.stats.keepStreak")}</span>
          )}
        </p>
      )}
      {wins.current >= 2 && (
        <p className="m-0 flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--ok-border)] bg-[var(--ok-soft)] px-3 py-1 text-xs">
          <span aria-hidden="true" className="text-base">
            🏆
          </span>
          <span className="font-display text-sm font-bold text-[var(--text-primary)]">
            {t("hub.stats.winStreak", { count: wins.current })}
          </span>
        </p>
      )}
      <a
        href="/stats"
        onClick={(e) => {
          e.preventDefault();
          navigate("/stats");
        }}
        className="text-sm font-bold text-[var(--accent-on-soft)] no-underline hover:underline"
      >
        {t("hub.stats.seeAll")}
      </a>
    </div>
  );
}

const NAV_ICON_PATHS: Record<HubTab, ReactNode> = {
  matches: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  play: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m10 8 6 4-6 4Z" />
    </>
  ),
  daily: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
      <path d="m12 13 1 2.2 2.3.3-1.7 1.6.5 2.3-2.1-1.2-2.1 1.2.5-2.3-1.7-1.6 2.3-.3Z" />
    </>
  ),
};

// The dashboard's sections. On a phone they are a tab bar along the bottom of
// the screen, in reach of a thumb; from `sm` up, a row of pills under the
// greeting. They are links rather than ARIA tabs because each is an address
// of its own, and that keeps the match buckets inside one of them the page's
// only tabs. A switch replaces the address instead of pushing one, so the
// back button leaves the hub rather than retracing every section visited.
//
// The badges carry across what a section would otherwise hide: how many
// matches wait on the player, and a daily game still unplayed on a day the
// player has not played at all.
function HubNav({
  current,
  movesNeeded,
  dailyWaiting,
}: {
  current: HubTab;
  movesNeeded: number;
  dailyWaiting: boolean;
}) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("hub.nav.label")}
      className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--border-subtle)] bg-[var(--surface-void)]/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:static sm:z-auto sm:mb-6 sm:border-0 sm:bg-transparent sm:pb-0 sm:backdrop-blur-none"
    >
      <ul className="m-0 grid list-none grid-cols-3 p-0 sm:inline-flex sm:gap-1 sm:rounded-[var(--radius-pill)] sm:border sm:border-[var(--border-subtle)] sm:bg-[var(--surface-2)] sm:p-1">
        {HUB_TABS.map((tab) => {
          const active = tab === current;
          let label: string | undefined;
          let badge: ReactNode = null;
          if (tab === "matches" && movesNeeded > 0) {
            label = t("hub.nav.matchesWaiting", { count: movesNeeded });
            badge = (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--party-pink)] px-1.5 text-xs leading-none font-bold text-[var(--text-on-accent)] tabular-nums">
                {movesNeeded}
              </span>
            );
          } else if (tab === "daily" && dailyWaiting) {
            label = t("hub.nav.dailyWaiting");
            badge = <span className="block size-2.5 rounded-full bg-[var(--party-pink)]" />;
          }
          return (
            <li key={tab}>
              <a
                href={`/${tab}`}
                aria-current={active ? "page" : undefined}
                aria-label={label}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/${tab}`, { replace: true });
                }}
                className={`relative flex flex-col items-center gap-1 px-2 pt-2 pb-2.5 text-xs font-bold whitespace-nowrap no-underline transition-colors duration-[var(--dur-fast)] sm:flex-row sm:gap-2 sm:rounded-[var(--radius-pill)] sm:px-4 sm:py-2 sm:text-sm ${
                  active
                    ? "text-[var(--accent-on-soft)] sm:bg-[var(--surface-1)] sm:text-[var(--text-primary)] sm:shadow-[var(--shadow-1),var(--edge-highlight)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                <span
                  className={`flex h-8 w-14 items-center justify-center rounded-[var(--radius-pill)] transition-colors duration-[var(--dur-fast)] sm:h-auto sm:w-auto ${
                    active ? "bg-[var(--accent-soft)] sm:bg-transparent" : ""
                  }`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="size-5 sm:size-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {NAV_ICON_PATHS[tab]}
                  </svg>
                </span>
                {t(`hub.nav.${tab}`)}
                {/* Over the icon's corner on a phone, after the label from `sm` up. */}
                {badge && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1.5 left-1/2 ml-3 sm:static sm:ml-0"
                  >
                    {badge}
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

type BucketKey = "yourTurn" | "waiting" | "finished" | "open";

// The first three are the player's own matches; `open` is everyone's public
// lobbies they could join, which is why it comes last.
const BUCKET_TABS: { key: BucketKey; glyph: string }[] = [
  { key: "yourTurn", glyph: "✦" },
  { key: "waiting", glyph: "⏳" },
  { key: "finished", glyph: "🏁" },
  { key: "open", glyph: "🌐" },
];

// The section `/` opens on: the matches when one waits on the player, the
// daily games when one of them is what keeps a streak alive today, and
// otherwise the games to start something with.
function openingTab(buckets: MatchBuckets, daily: DailyHub | null): HubTab {
  if (buckets.yourTurn.length > 0) return "matches";
  const { play } = buckets.streaks;
  const dailyUnplayed = daily?.games.some((game) => game.mine === null) ?? false;
  if (play.current > 0 && !play.today && dailyUnplayed) return "daily";
  return "play";
}

export function Dashboard({ tab }: { tab: HubTab | null }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { player, notifyUnauthorized } = useSession();
  const [buckets, setBuckets] = useState<MatchBuckets | null>(null);
  const [games, setGames] = useState<GameMeta[]>([]);
  const [daily, setDaily] = useState<DailyHub | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  // Who can join the next match a tile starts. Private every time the hub
  // opens: listing a match for everyone should never happen by leftover.
  const [newVisibility, setNewVisibility] = useState<MatchVisibility>("private");

  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const [bucket, setBucket] = useState<BucketKey>("yourTurn");
  // The opening bucket is chosen once, from the first load that returns
  // anything: someone with nothing to play but three games in flight should
  // land on a populated bucket. Later polls must not move it under them.
  const pickedOpeningBucket = useRef(false);

  const refresh = useCallback(async () => {
    try {
      // The daily games are a section of their own, so failing to read them
      // costs that section, never the hub.
      const [nextBuckets, nextGames, nextDaily] = await Promise.all([
        listMatches(),
        getGames(),
        getDailyHub().catch(() => null),
      ]);
      setBuckets(nextBuckets);
      setGames(nextGames);
      if (nextDaily) setDaily(nextDaily);
      setError(null);
      // The tab badge: the dashboard's "your turn" bucket is the full,
      // authoritative set of matches awaiting this player.
      setDashboardYourTurn(nextBuckets.yourTurn.map((m) => m.id));
      if (!pickedOpeningBucket.current) {
        pickedOpeningBucket.current = true;
        const firstFilled = BUCKET_TABS.find((tab) => nextBuckets[tab.key].length > 0);
        if (firstFilled) setBucket(firstFilled.key);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        notifyUnauthorized();
        return;
      }
      setError(errorText(t, err, t("hub.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [notifyUnauthorized, t]);

  // A return to the hub must show fresh buckets. There is no cache to
  // invalidate for that — this component holds no state across mounts, and
  // App.tsx's route switch unmounts it entirely whenever the route is not
  // "dashboard" (see RouteContent). Every navigation back to the hub from
  // another page therefore mounts a brand new Dashboard, which this effect
  // refetches from scratch. Moving between its sections keeps it mounted.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // `/` names no section, so once there is something to choose by, its
  // address is swapped for the section's own: a reload, or the back button
  // from a match opened there, returns to the same section rather than
  // choosing again.
  useEffect(() => {
    if (tab === null && buckets) {
      navigate(`/${openingTab(buckets, daily)}`, { replace: true });
    }
  }, [tab, buckets, daily]);

  // Refresh on tab focus, on the tab becoming visible again, and on a poll
  // while the tab is visible. This is browser-side setInterval, not a
  // Durable Object timer — the ban on setInterval is scoped to DOs (they
  // must use ctx.storage.setAlarm() instead); a plain browser tab has no
  // such constraint. There is no push from the server for the hub (unlike a
  // match's own WebSocket), so a lobby someone else just made public only
  // shows up here on the next poll or the next time this tab regains
  // visibility.
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
    function onVisibilityChange() {
      if (!document.hidden) refresh();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [refresh]);

  async function handlePlay(gameId: string) {
    if (creatingId) return;
    setCreatingId(gameId);
    setCreateError(null);
    try {
      const { code } = await createMatch(gameId, newVisibility);
      navigate(`/m/${code}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        notifyUnauthorized();
        return;
      }
      setCreateError(errorText(t, err, t("hub.createFailed")));
    } finally {
      setCreatingId(null);
    }
  }

  async function handleJoin(e: FormEvent) {
    e.preventDefault();
    const code = normalizeMatchCode(joinCode);
    if (!code) {
      setJoinError(t("join.missingCode"));
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
      setJoinError(errorText(t, err, t("join.failed")));
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
        <Notice tone="danger" action={{ label: t("retry"), onClick: () => refresh() }}>
          {error}
        </Notice>
      </main>
    );
  }

  const myPlayerId = player?.playerId ?? "";
  const data = buckets ?? {
    yourTurn: [],
    waiting: [],
    finished: [],
    open: [],
    stats: { played: 0, finished: 0, won: 0, since: null },
    streaks: {
      play: { current: 0, best: 0, today: false },
      wins: { current: 0, best: 0 },
    },
  };
  const section = tab ?? openingTab(data, daily);
  const turnCount = data.yourTurn.length;
  // Someone who has not played anything yet has no reason to come back, so is not asked to install.
  const hasOwnMatches =
    data.yourTurn.length + data.waiting.length + data.finished.length > 0 ||
    (daily?.games.some((game) => game.mine !== null) ?? false);
  const dailyWaiting =
    !data.streaks.play.today && (daily?.games.some((game) => game.mine === null) ?? false);
  // Coming-soon games go at the very end, so every tile that does something
  // sits together at the front of the shelf.
  const playable = games.filter((g) => !g.comingSoon);
  const comingSoon = games.filter((g) => g.comingSoon);
  const dailyGames = (daily?.games ?? []).flatMap((summary) => {
    const meta = getDailyMeta(summary.gameId);
    return meta ? [{ meta, summary }] : [];
  });

  return (
    <main id="main-content" className="app-container">
      <section className="party-pop mb-5 sm:mb-6">
        <h1 className="m-0 font-display text-2xl font-bold tracking-tight text-balance text-[var(--text-primary)] sm:text-4xl">
          {player ? t("hub.greeting", { nickname: player.nickname }) : t("hub.greetingNoName")}
        </h1>
        <StatusRow movesNeeded={turnCount} streaks={data.streaks} />
        {hasOwnMatches && <InstallPrompt className="mt-4" />}
      </section>

      <HubNav current={section} movesNeeded={turnCount} dailyWaiting={dailyWaiting} />

      {section === "matches" && (
        <section>
          <Tabs
            selectedKey={bucket}
            onSelectionChange={(key) => setBucket(key as BucketKey)}
            className="w-full"
          >
            {/* From `sm` up, the width overrides below undo HeroUI's own
                `min-w-full` on the list and `w-full` on each tab, which would
                otherwise stretch this pill across the whole page. A phone is
                too narrow for all four tabs in one row, in either language, so
                there they sit two by two, filling the width, rather than
                wrapping inside a tab or scrolling one out of sight. */}
            <Tabs.ListContainer className="w-full max-w-full self-start bg-transparent sm:w-fit">
              <Tabs.List
                aria-label={t("hub.tabsLabel")}
                className="grid w-full min-w-0 grid-cols-2 gap-1 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-2)] p-1 sm:flex sm:w-fit sm:gap-0 sm:rounded-[var(--radius-pill)]"
              >
                {BUCKET_TABS.map((tab) => (
                  <Tabs.Tab
                    key={tab.key}
                    id={tab.key}
                    className="gap-2 rounded-[var(--radius-pill)] whitespace-nowrap sm:w-auto"
                  >
                    {t(`hub.tabs.${tab.key}`)}
                    <span className="text-xs font-bold opacity-70">{data[tab.key].length}</span>
                    <Tabs.Indicator />
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs.ListContainer>
            {BUCKET_TABS.map((tab) => (
              <Tabs.Panel key={tab.key} id={tab.key} className="pt-4 sm:pt-5">
                <Bucket
                  matches={data[tab.key]}
                  games={games}
                  myPlayerId={myPlayerId}
                  accent={tab.key === "yourTurn"}
                  callToAction={tab.key === "open" ? t("card.join") : undefined}
                  emptyText={t(`hub.empty.${tab.key}`)}
                  emptyGlyph={tab.glyph}
                />
              </Tabs.Panel>
            ))}
          </Tabs>
        </section>
      )}

      {section === "play" && (
        <section>
          {/* On a phone the tab bar already names this section, and the heading would push the
              switch onto a row of its own, so there it is only for screen readers. */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h2 className="m-0 font-display text-sm font-bold tracking-[0.15em] text-[var(--text-muted)] uppercase max-sm:sr-only">
              {t("hub.pickGame")}
            </h2>
            <VisibilitySwitch
              visibility={newVisibility}
              onChange={setNewVisibility}
              isDisabled={creatingId !== null}
            />
          </div>
          {createError && (
            <div className="mb-3">
              <Notice tone="danger">{createError}</Notice>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
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
            {comingSoon.map((g, i) => (
              <GameTile
                key={g.id}
                meta={g}
                index={playable.length + i}
                busy={false}
                disabled
                onPlay={() => {}}
              />
            ))}
          </div>
          <JoinStrip
            index={games.length}
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
        </section>
      )}

      {/* The day's single-player games. However many there are, each is a
          row on a phone, so they all fit on one screen. Until the first read
          of them lands this says so; after that, a poll that fails keeps
          them as they were, so a hiccup never blanks the section. */}
      {section === "daily" && (
        <section>
          <div className="mb-3 flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="m-0 font-display text-sm font-bold tracking-[0.15em] text-[var(--text-muted)] uppercase">
                {t("daily.section")}
              </h2>
              {daily && (
                <span className="text-xs font-bold text-[var(--text-muted)]">
                  {t("daily.newBoard", { when: relativeTime(language, daily.endsAt, Date.now()) })}
                </span>
              )}
            </div>
            <p className="m-0 text-sm text-[var(--text-muted)]">{t("daily.sectionHint")}</p>
          </div>
          {daily ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
              {dailyGames.map(({ meta, summary }, i) => (
                <DailyTile key={meta.id} meta={meta} summary={summary} style={staggerStyle(i)} />
              ))}
            </div>
          ) : (
            <Notice tone="danger" action={{ label: t("retry"), onClick: () => refresh() }}>
              {t("daily.loadFailed")}
            </Notice>
          )}
        </section>
      )}

      {/* Room for the tab bar's own inset over a phone's home indicator, which the container's
          padding does not count. */}
      <div aria-hidden="true" className="h-[env(safe-area-inset-bottom)] sm:hidden" />
    </main>
  );
}
