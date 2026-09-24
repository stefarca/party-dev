import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type {
  ChampionEntry,
  Leaderboard,
  PlayerId,
  PlayerStatsDetail,
  Rival,
  ShameEntry,
} from "../../shared/protocol";
import { ApiError, getLeaderboard, getMyStats } from "../api";
import { GameGlyph } from "../components/GameGlyph";
import { PlayerAvatar } from "../components/PlayerAvatar";
import { EmptyState, Notice, Skeleton } from "../components/states";
import { errorText } from "../errors";
import { compactDuration, longDuration } from "../format";
import { useGameName, useLanguage } from "../i18n";
import { navigate } from "../router";
import { useSession } from "../session";

// The player's stats, and the week's boards: their streaks, their record game
// by game, how they stand against everyone they have played, and — for
// everyone — who won most this week and who kept everyone waiting. Two reads,
// each failing on its own, so a board that will not load never costs the
// player their own numbers.

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

function BackLink() {
  const { t } = useTranslation();
  return (
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
  );
}

function Card({
  title,
  glyph,
  hint,
  children,
  className = "",
}: {
  title: string;
  glyph?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`party-pop flex min-w-0 flex-col gap-4 rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-5 shadow-[var(--shadow-2),var(--edge-highlight)] ${className}`}
    >
      <div className="flex flex-col gap-1">
        <h2 className="m-0 font-display text-lg font-bold text-[var(--text-primary)]">
          {glyph && <span aria-hidden="true">{glyph} </span>}
          {title}
        </h2>
        {hint && <p className="m-0 text-sm text-[var(--text-muted)]">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function percent(language: string, part: number, whole: number): string {
  if (whole === 0) return "–";
  return new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 0 }).format(
    part / whole,
  );
}

// "2 days, 4 hours", never an empty string for a wait under a second.
function duration(language: string, ms: number): string {
  return longDuration(language, Math.max(ms, 1000));
}

// "2d 4h" where there is no room for more, spelled out for a screen reader.
function CompactDuration({ ms }: { ms: number }) {
  const language = useLanguage();
  return (
    <>
      <span aria-hidden="true">{compactDuration(language, ms)}</span>
      <span className="sr-only">{duration(language, ms)}</span>
    </>
  );
}

// One streak: its size, its best, and a line on what to do about it. The play
// streak's flame is grey until today counts, the same as on the hub.
function StreakCard({
  glyph,
  label,
  value,
  best,
  note,
  lit,
  atRisk = false,
}: {
  glyph: string;
  label: string;
  value: string;
  best: string;
  note: string;
  lit: boolean;
  atRisk?: boolean;
}) {
  return (
    <div
      className={`flex items-start gap-4 rounded-[var(--radius-lg)] border-2 p-4 ${
        atRisk
          ? "border-dashed border-[var(--warn-border)] bg-[var(--surface-2)]"
          : lit
            ? "border-[var(--warn-border)] bg-[var(--warn-soft)]"
            : "border-[var(--border-subtle)] bg-[var(--surface-2)]"
      }`}
    >
      <span aria-hidden="true" className={`text-4xl leading-none ${lit ? "" : "grayscale"}`}>
        {glyph}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 className="m-0 text-xs font-bold tracking-[0.12em] text-[var(--text-muted)] uppercase">
          {label}
        </h3>
        <p className="m-0 font-display text-2xl font-bold text-[var(--text-primary)]">{value}</p>
        <p
          className={`m-0 text-sm ${atRisk ? "font-bold text-[var(--warn-fg)]" : "text-[var(--text-secondary)]"}`}
        >
          {note}
        </p>
        <p className="m-0 text-xs text-[var(--text-muted)]">{best}</p>
      </div>
    </div>
  );
}

function Streaks({ stats }: { stats: PlayerStatsDetail }) {
  const { t } = useTranslation();
  const { play, wins } = stats.streaks;
  const playNote =
    play.current === 0
      ? t("stats.streaks.playNone")
      : play.today
        ? t("stats.streaks.playDone")
        : t("stats.streaks.playAtRisk");
  return (
    <section
      aria-label={t("stats.streaks.label")}
      className="party-pop grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      <StreakCard
        glyph="🔥"
        label={t("stats.streaks.play")}
        value={t("stats.streaks.days", { count: play.current })}
        best={t("stats.streaks.best", { value: t("stats.streaks.days", { count: play.best }) })}
        note={playNote}
        lit={play.current > 0 && play.today}
        atRisk={play.current > 0 && !play.today}
      />
      <StreakCard
        glyph="🏆"
        label={t("stats.streaks.wins")}
        value={t("stats.streaks.winsCount", { count: wins.current })}
        best={t("stats.streaks.best", {
          value: t("stats.streaks.winsCount", { count: wins.best }),
        })}
        note={wins.current > 0 ? t("stats.streaks.winsLive") : t("stats.streaks.winsNone")}
        lit={wins.current > 0}
      />
    </section>
  );
}

function RecordCard({ stats }: { stats: PlayerStatsDetail }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { record, reply } = stats;
  const cells: [string, string][] = [
    [String(record.played), t("hub.stats.played")],
    [String(record.won), t("hub.stats.won")],
    [String(record.finished), t("hub.stats.finished")],
    [percent(language, record.won, record.finished), t("stats.record.winRate")],
  ];
  return (
    <Card title={t("stats.record.title")}>
      <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cells.map(([value, label]) => (
          <div
            key={label}
            className="flex flex-col rounded-[var(--radius-md)] bg-[var(--surface-2)] px-3 py-2"
          >
            <dt className="order-2 text-xs text-[var(--text-muted)]">{label}</dt>
            <dd className="order-1 m-0 font-display text-2xl font-bold tabular-nums text-[var(--text-primary)]">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-0.5">
        <p className="m-0 text-sm text-[var(--text-secondary)]">
          <span className="font-bold text-[var(--text-primary)]">{t("stats.record.reply")}</span>
          {": "}
          {reply.medianMs === null
            ? t("stats.record.replyNone")
            : duration(language, reply.medianMs)}
        </p>
        <p className="m-0 text-xs text-[var(--text-muted)]">
          {t("stats.record.replyHint", { days: reply.days })}
        </p>
      </div>
    </Card>
  );
}

function GamesCard({ stats }: { stats: PlayerStatsDetail }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const gameName = useGameName();
  return (
    <Card title={t("stats.games.title")}>
      {stats.games.length === 0 ? (
        <EmptyState glyph="🎲">{t("stats.games.empty")}</EmptyState>
      ) : (
        <table className="w-full border-separate border-spacing-y-1.5 text-sm">
          <caption className="sr-only">{t("stats.games.label")}</caption>
          <thead>
            <tr className="text-left text-xs text-[var(--text-muted)]">
              <th scope="col" className="px-2 font-semibold">
                {t("stats.games.game")}
              </th>
              <th scope="col" className="px-2 text-right font-semibold">
                {t("stats.games.played")}
              </th>
              <th scope="col" className="px-2 text-right font-semibold">
                {t("stats.games.won")}
              </th>
              <th scope="col" className="px-2 text-right font-semibold">
                {t("stats.games.winRate")}
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.games.map((game) => (
              <tr key={game.gameId} className="bg-[var(--surface-2)]">
                <th
                  scope="row"
                  className="rounded-l-[var(--radius-md)] px-2 py-1.5 text-left font-bold text-[var(--text-primary)]"
                >
                  <span className="flex items-center gap-2">
                    <GameGlyph gameId={game.gameId} className="size-7" />
                    {gameName(game.gameId)}
                  </span>
                </th>
                <td className="px-2 text-right tabular-nums">{game.played}</td>
                <td className="px-2 text-right tabular-nums">{game.won}</td>
                <td className="rounded-r-[var(--radius-md)] px-2 text-right font-bold tabular-nums">
                  {percent(language, game.won, game.finished)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// Which rival is the player's nemesis (the one furthest ahead of them) and
// which their favourite victim (the one furthest behind). Each needs a real
// lead, so an even rivalry is neither.
function rivalTags(rivals: Rival[]): Map<PlayerId, "nemesis" | "victim"> {
  const tags = new Map<PlayerId, "nemesis" | "victim">();
  const lead = (r: Rival) => r.wins - r.losses;
  const nemesis = rivals
    .filter((r) => lead(r) < 0)
    .sort((a, b) => lead(a) - lead(b) || b.losses - a.losses)[0];
  const victim = rivals
    .filter((r) => lead(r) > 0)
    .sort((a, b) => lead(b) - lead(a) || b.wins - a.wins)[0];
  if (nemesis) tags.set(nemesis.playerId, "nemesis");
  if (victim) tags.set(victim.playerId, "victim");
  return tags;
}

function RivalRow({ rival, tag }: { rival: Rival; tag: "nemesis" | "victim" | undefined }) {
  const { t } = useTranslation();
  const gameName = useGameName();
  const decided = rival.wins + rival.losses;
  return (
    <li className="flex items-start gap-3 rounded-[var(--radius-md)] bg-[var(--surface-2)] px-3 py-2.5">
      <PlayerAvatar id={rival.playerId} nickname={rival.nickname} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-bold text-[var(--text-primary)]">
            {t("stats.rivals.record", {
              wins: rival.wins,
              losses: rival.losses,
              name: rival.nickname,
            })}
          </span>
          {rival.draws > 0 && (
            <span className="text-xs text-[var(--text-muted)]">
              {t("stats.rivals.draws", { count: rival.draws })}
            </span>
          )}
          {tag && (
            <span
              className={`rounded-[var(--radius-pill)] px-2 py-0.5 text-[0.7rem] font-bold ${
                tag === "nemesis"
                  ? "bg-[var(--danger-soft)] text-[var(--danger-fg)]"
                  : "bg-[var(--ok-soft)] text-[var(--ok-fg)]"
              }`}
            >
              {tag === "nemesis"
                ? `😈 ${t("stats.rivals.nemesis")}`
                : `🎯 ${t("stats.rivals.victim")}`}
            </span>
          )}
        </div>
        {/* The same numbers as the sentence above, drawn: wins against losses. */}
        {decided > 0 && (
          <div
            aria-hidden="true"
            className="flex h-1.5 overflow-hidden rounded-[var(--radius-pill)] bg-[var(--danger-soft)]"
          >
            <div
              className="bg-[var(--ok-fg)]"
              style={{ width: `${(rival.wins / decided) * 100}%` }}
            />
            <div
              className="bg-[var(--danger-fg)]"
              style={{ width: `${(rival.losses / decided) * 100}%` }}
            />
          </div>
        )}
        <p className="m-0 text-xs text-[var(--text-muted)]">
          {rival.games
            .map((game) =>
              t("stats.rivals.game", {
                game: gameName(game.gameId),
                wins: game.wins,
                losses: game.losses,
              }),
            )
            .join(" · ")}
        </p>
      </div>
    </li>
  );
}

function RivalsCard({ stats }: { stats: PlayerStatsDetail }) {
  const { t } = useTranslation();
  const tags = rivalTags(stats.rivals);
  return (
    <Card title={t("stats.rivals.title")} hint={t("stats.rivals.hint")}>
      {stats.rivals.length === 0 ? (
        <EmptyState glyph="⚔️">{t("stats.rivals.empty")}</EmptyState>
      ) : (
        <ul aria-label={t("stats.rivals.title")} className="m-0 flex list-none flex-col gap-2 p-0">
          {stats.rivals.map((rival) => (
            <RivalRow key={rival.playerId} rival={rival} tag={tags.get(rival.playerId)} />
          ))}
        </ul>
      )}
    </Card>
  );
}

// One place on a board: rank, player, and whatever the board measures them by.
function BoardRow({
  rank,
  playerId,
  nickname,
  mine,
  primary,
  secondary,
}: {
  rank: number;
  playerId: PlayerId;
  nickname: string;
  mine: boolean;
  primary: ReactNode;
  secondary: ReactNode;
}) {
  const { t } = useTranslation();
  const medal = MEDALS[rank];
  return (
    <li
      className={`flex items-center gap-3 rounded-[var(--radius-md)] px-2.5 py-2 ${
        mine
          ? "bg-[var(--accent-soft)] ring-2 ring-[var(--border-accent)]"
          : "bg-[var(--surface-2)]"
      }`}
    >
      <span className="flex w-8 flex-none justify-center font-display text-sm font-bold tabular-nums text-[var(--text-secondary)]">
        {medal ? (
          <>
            <span aria-hidden="true" className="text-xl">
              {medal}
            </span>
            <span className="sr-only">{t("stats.week.rank", { rank })}</span>
          </>
        ) : (
          t("stats.week.rank", { rank })
        )}
      </span>
      <PlayerAvatar id={playerId} nickname={nickname} size="sm" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-bold text-[var(--text-primary)]">{nickname}</span>
          {mine && (
            <span
              className="flex-none rounded-[var(--radius-pill)] px-1.5 py-px text-[0.65rem] font-bold"
              style={{ background: "var(--accent-soft)", color: "var(--accent-on-soft)" }}
            >
              {t("stats.week.you")}
            </span>
          )}
        </span>
        {secondary && <span className="text-xs text-[var(--text-muted)]">{secondary}</span>}
      </span>
      <span className="flex-none text-right font-display text-sm font-bold text-[var(--text-primary)]">
        {primary}
      </span>
    </li>
  );
}

function ChampionsBoard({ entries, me }: { entries: ChampionEntry[]; me: PlayerId }) {
  const { t } = useTranslation();
  if (entries.length === 0) {
    return <EmptyState glyph="🏆">{t("stats.week.championsEmpty")}</EmptyState>;
  }
  return (
    <ol
      aria-label={t("stats.week.championsLabel")}
      className="m-0 flex list-none flex-col gap-1.5 p-0"
    >
      {entries.map((entry, i) => (
        <BoardRow
          key={entry.playerId}
          rank={i + 1}
          playerId={entry.playerId}
          nickname={entry.nickname}
          mine={entry.playerId === me}
          primary={t("stats.week.championLine", { won: entry.won, finished: entry.finished })}
          secondary={null}
        />
      ))}
    </ol>
  );
}

function ShameBoard({ entries, me }: { entries: ShameEntry[]; me: PlayerId }) {
  const { t } = useTranslation();
  if (entries.length === 0) {
    return <EmptyState glyph="🐌">{t("stats.week.shameEmpty")}</EmptyState>;
  }
  return (
    <ol aria-label={t("stats.week.shameLabel")} className="m-0 flex list-none flex-col gap-1.5 p-0">
      {entries.map((entry, i) => (
        <BoardRow
          key={entry.playerId}
          rank={i + 1}
          playerId={entry.playerId}
          nickname={entry.nickname}
          mine={entry.playerId === me}
          primary={<CompactDuration ms={entry.waitedMs} />}
          secondary={
            <>
              {t("stats.week.turns", { count: entry.turns })} · {t("stats.week.longest")}{" "}
              <CompactDuration ms={entry.longestMs} />
              {entry.stalled > 0 && (
                <span className="font-bold text-[var(--danger-fg)]">
                  {" "}
                  · {t("stats.week.stalled", { count: entry.stalled })}
                </span>
              )}
            </>
          }
        />
      ))}
    </ol>
  );
}

function WeekSection({
  board,
  error,
  me,
  onRetry,
}: {
  board: Leaderboard | null;
  error: unknown;
  me: PlayerId;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const loading = <Skeleton height="8rem" rounded="lg" />;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 font-display text-sm font-bold tracking-[0.15em] text-[var(--text-muted)] uppercase">
          {t("stats.week.title")}
        </h2>
        <p className="m-0 text-sm text-[var(--text-muted)]">{t("stats.week.hint")}</p>
      </div>
      {error ? (
        <Notice tone="danger" action={{ label: t("retry"), onClick: onRetry }}>
          {errorText(t, error, t("stats.week.loadFailed"))}
        </Notice>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card glyph="🏆" title={t("stats.week.champions")}>
            {board ? <ChampionsBoard entries={board.champions} me={me} /> : loading}
          </Card>
          <Card glyph="🐌" title={t("stats.week.shame")} hint={t("stats.week.shameHint")}>
            {board ? <ShameBoard entries={board.shame} me={me} /> : loading}
          </Card>
        </div>
      )}
    </section>
  );
}

function StatsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton height="7rem" rounded="lg" />
        <Skeleton height="7rem" rounded="lg" />
      </div>
      <Skeleton height="10rem" rounded="xl" />
      <Skeleton height="12rem" rounded="xl" />
    </div>
  );
}

export function StatsPage() {
  const { t } = useTranslation();
  const language = useLanguage();
  const { player, notifyUnauthorized } = useSession();
  const [stats, setStats] = useState<PlayerStatsDetail | null>(null);
  const [statsError, setStatsError] = useState<unknown>(null);
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [boardError, setBoardError] = useState<unknown>(null);

  // True when `err` was a lapsed session, which the app handles.
  const unauthorized = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        notifyUnauthorized();
        return true;
      }
      return false;
    },
    [notifyUnauthorized],
  );

  const loadStats = useCallback(async () => {
    setStatsError(null);
    try {
      setStats(await getMyStats());
    } catch (err) {
      if (!unauthorized(err)) setStatsError(err);
    }
  }, [unauthorized]);

  const loadBoard = useCallback(async () => {
    setBoardError(null);
    try {
      setBoard(await getLeaderboard());
    } catch (err) {
      if (!unauthorized(err)) setBoardError(err);
    }
  }, [unauthorized]);

  useEffect(() => {
    void loadStats();
    void loadBoard();
  }, [loadStats, loadBoard]);

  let mine: ReactNode;
  if (statsError) {
    mine = (
      <Notice tone="danger" action={{ label: t("retry"), onClick: () => void loadStats() }}>
        {errorText(t, statsError, t("stats.loadFailed"))}
      </Notice>
    );
  } else if (!stats) {
    mine = <StatsSkeleton />;
  } else {
    mine = (
      <>
        <Streaks stats={stats} />
        <RecordCard stats={stats} />
        <RivalsCard stats={stats} />
        <GamesCard stats={stats} />
      </>
    );
  }

  return (
    <main id="main-content" className="app-container">
      <BackLink />
      <header className="party-pop mb-6 flex flex-col gap-1">
        <h1 className="m-0 font-display text-3xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl">
          {t("stats.title")}
        </h1>
        {stats?.record.since != null && (
          <p className="m-0 text-sm text-[var(--text-muted)]">
            {t("stats.since", {
              date: new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(
                stats.record.since,
              ),
            })}
          </p>
        )}
      </header>
      <div className="mb-10 flex flex-col gap-4">{mine}</div>
      <WeekSection
        board={board}
        error={boardError}
        me={player?.playerId ?? ""}
        onRetry={() => void loadBoard()}
      />
    </main>
  );
}
