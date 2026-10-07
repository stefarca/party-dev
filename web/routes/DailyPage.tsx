import { AlertDialog, Button } from "@heroui/react";
import { Suspense, lazy, useEffect, useState } from "react";
import type { ComponentType, LazyExoticComponent } from "react";
import { useTranslation } from "react-i18next";

import type { DailyGameMeta } from "../../games/catalog";
import { getDailyMeta } from "../../games/catalog";
import { dailyUi } from "../../games/registry";
import type {
  DailyChart as Chart,
  DailyRunSnapshot,
  DailyStanding,
  DailyUiProps,
} from "../../shared/protocol";
import { useCheckWhenDone } from "../achievements";
import { getDailyStanding } from "../api";
import { Confetti } from "../components/Confetti";
import { DailyChart } from "../components/DailyChart";
import { GameErrorBoundary } from "../components/GameErrorBoundary";
import { GameGlyph } from "../components/GameGlyph";
import { GameSurface } from "../components/GameSurface";
import { Notice, Skeleton } from "../components/states";
import { errorText } from "../errors";
import { dayLabel, relativeTime, scoreText } from "../format";
import { useGameName, useLanguage } from "../i18n";
import { navigate } from "../router";
import { useSession } from "../session";
import { shareLink, shareUrl } from "../share";
import { useDailyChart, useDailyRun } from "../useDaily";

// Today's run at one daily game, beside the day's chart. The game's own UI
// renders the board; everything around it — starting the run, ending it,
// what it scored and where that placed — is this page's, and the same for
// every daily game. Keep game-specific logic out of it.

// Created once per game, never per render: a fresh `lazy()` would remount the
// board on every render.
const lazyUiCache = new Map<string, LazyExoticComponent<ComponentType<DailyUiProps>>>();

function getLazyUi(gameId: string): LazyExoticComponent<ComponentType<DailyUiProps>> | undefined {
  const loader = dailyUi[gameId];
  if (!loader) return undefined;
  let cached = lazyUiCache.get(gameId);
  if (!cached) {
    cached = lazy(loader);
    lazyUiCache.set(gameId, cached);
  }
  return cached;
}

// The current time, refreshed every half minute: enough for "in 5 hours".
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function BackLink() {
  const { t } = useTranslation();
  return (
    <a
      href="/daily"
      onClick={(e) => {
        e.preventDefault();
        navigate("/daily");
      }}
      className="mb-4 inline-flex items-center gap-1 text-sm font-bold text-[var(--text-muted)] no-underline transition-colors hover:text-[var(--text-primary)]"
    >
      {t("match.hub")}
    </a>
  );
}

function StartCard({
  starting,
  error,
  onStart,
}: {
  starting: boolean;
  error: unknown;
  onStart: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="party-pop flex flex-col items-start gap-3 rounded-[var(--radius-xl)] border-2 border-[var(--border-accent)] bg-[var(--surface-1)] p-6 shadow-[var(--shadow-2),var(--glow-accent)]">
      <h2 className="m-0 font-display text-xl font-bold text-[var(--text-primary)]">
        {t("daily.start.title")}
      </h2>
      <p className="m-0 text-[var(--text-secondary)]">{t("daily.start.body")}</p>
      {error !== null && (
        <p role="alert" className="m-0 text-sm text-danger">
          {errorText(t, error, t("daily.start.failed"))}
        </p>
      )}
      <Button
        onPress={onStart}
        isDisabled={starting}
        className="rounded-[var(--radius-pill)] px-6 font-display font-bold transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] not-disabled:hover:scale-105 not-disabled:active:scale-95"
      >
        {starting ? t("daily.start.starting") : t("daily.start.action")}
      </Button>
    </section>
  );
}

// Asks before ending the run: there is no second one today, so one stray tap
// must not do it.
function EndRun({ onEnd }: { onEnd: () => Promise<void> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await onEnd();
      setOpen(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog
      isOpen={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <Button
        variant="tertiary"
        size="sm"
        className="self-start rounded-[var(--radius-pill)] px-4 font-bold"
      >
        {t("daily.end.trigger")}
      </Button>
      <AlertDialog.Backdrop>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[400px]">
            <AlertDialog.Header>
              <AlertDialog.Icon status="warning" />
              <AlertDialog.Heading>{t("daily.end.title")}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="flex flex-col gap-2">
              <p className="m-0">{t("daily.end.body")}</p>
              {error !== null && (
                <p role="alert" className="m-0 text-sm text-danger">
                  {errorText(t, error, t("daily.end.failed"))}
                </p>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                {t("daily.end.cancel")}
              </Button>
              <Button variant="danger" isDisabled={busy} onPress={handleConfirm}>
                {t("daily.end.confirm")}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}

// What a finished run scored, and where that put it on its day's chart. The
// rank is read from the chart the page is showing, so it is left out while
// the player is looking at another day's.
function RunResult({
  run,
  meta,
  name,
  chart,
  now,
}: {
  run: DailyRunSnapshot;
  meta: DailyGameMeta;
  name: string;
  chart: Chart | null;
  now: number;
}) {
  const { t } = useTranslation();
  const language = useLanguage();
  const standing = chart?.day === run.day ? chart.mine : null;
  return (
    <section className="party-pop flex flex-col gap-1.5 rounded-[var(--radius-xl)] border-2 border-[var(--border-accent)] bg-[var(--surface-1)] p-5 shadow-[var(--shadow-2),var(--glow-accent)]">
      <Confetti fire={standing?.rank === 1} />
      <h2 className="m-0 font-display text-xl font-bold text-[var(--text-primary)]">
        {t("daily.result.title")}
      </h2>
      <p className="m-0 text-[var(--text-secondary)]">
        {run.score.value !== null
          ? t("daily.result.score", { score: scoreText(language, run.score.value, meta.format) })
          : t("daily.result.unranked")}
      </p>
      {standing?.rank != null && chart && (
        <p className="m-0 font-bold text-[var(--text-primary)]">
          {t("daily.result.rank", { rank: standing.rank, count: chart.finished })}
        </p>
      )}
      <p className="m-0 text-sm text-[var(--text-muted)]">
        {t("daily.result.comeBack", { when: relativeTime(language, run.endsAt, now) })}
      </p>
      {run.score.value !== null && (
        <ChallengeFriends
          meta={meta}
          name={name}
          day={run.day}
          score={run.score.value}
          rank={standing?.rank ?? null}
          count={chart?.finished ?? 0}
        />
      )}
    </section>
  );
}

// Sends this run to friends as a challenge: a link to the game that names
// this player's run, so its preview in the chat reads "Ada scored 2,048 at
// 2048. Can you beat it?", and the page it opens says what there is to beat.
function ChallengeFriends({
  meta,
  name,
  day,
  score,
  rank,
  count,
}: {
  meta: DailyGameMeta;
  name: string;
  day: string;
  score: number;
  rank: number | null;
  count: number;
}) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { player } = useSession();
  const [copied, setCopied] = useState(false);
  if (!player) return null;

  async function handlePress() {
    const params = new URLSearchParams({ from: player!.playerId, day });
    const url = shareUrl(`/daily/${encodeURIComponent(meta.id)}?${params}`, language);
    const values = { game: name, score: scoreText(language, score, meta.format) };
    const text =
      rank !== null
        ? t("daily.challenge.shareRanked", { ...values, rank, count })
        : t("daily.challenge.share", values);
    if ((await shareLink({ title: name, text, url })) === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <Button
      onPress={() => void handlePress()}
      className="mt-2 self-start rounded-[var(--radius-pill)] px-6 font-display font-bold transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] hover:scale-105 active:scale-95"
    >
      {copied ? t("daily.challenge.copied") : t("daily.challenge.action")}
    </Button>
  );
}

// The challenge a link carried in, as `?from=<playerId>&day=<day>`: read once,
// when the page opens. The player's own link, sent back to them, is no
// challenge.
function useChallenge(gameId: string, myPlayerId: string | undefined): DailyStanding | null {
  const [challenge] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const from = params.get("from");
    const day = params.get("day");
    return from && day ? { from, day } : null;
  });
  const [standing, setStanding] = useState<DailyStanding | null>(null);
  const from = challenge?.from === myPlayerId ? null : challenge?.from;
  const day = challenge?.day;
  useEffect(() => {
    if (!from || !day) return;
    let cancelled = false;
    // A challenge that cannot be read is simply not shown: the page is still
    // the game's, and today's run is still there to play.
    getDailyStanding(gameId, day, from).then(
      (result) => !cancelled && setStanding(result),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [gameId, from, day]);
  return standing;
}

// Whether `a` beats `b` on a chart ranked in `order`.
function beats(order: DailyGameMeta["order"], a: number, b: number): boolean {
  return order === "asc" ? a < b : a > b;
}

// What a challenge link asks: whose run, what it scored, and, once this
// player's own run on the same board is over, how the two compare. A
// challenge from another day is still shown, but can only be admired: today's
// board is a different one.
function ChallengeCard({
  standing,
  meta,
  today,
  run,
}: {
  standing: DailyStanding;
  meta: DailyGameMeta;
  today: string;
  run: DailyRunSnapshot | null;
}) {
  const { t } = useTranslation();
  const language = useLanguage();
  const theirs = standing.run;
  if (!theirs || theirs.status !== "done" || theirs.score === null) return null;
  const name = theirs.nickname;
  const score = scoreText(language, theirs.score, meta.format);
  const sameBoard = standing.day === today;
  const mine = sameBoard && run?.status === "done" ? run.score.value : null;

  let verdict: string;
  let won = false;
  if (!sameBoard) {
    verdict = t("daily.challenge.otherDay", { day: dayLabel(language, standing.day) });
  } else if (mine === null) {
    verdict = t(run?.status === "done" ? "daily.challenge.noScore" : "daily.challenge.toBeat", {
      score,
    });
  } else if (mine === theirs.score) {
    verdict = t("daily.challenge.tie", { name });
  } else if (beats(meta.order, mine, theirs.score)) {
    verdict = t("daily.challenge.won", { name });
    won = true;
  } else {
    verdict = t("daily.challenge.lost", { name });
  }

  return (
    <section
      aria-label={t("daily.challenge.label")}
      className="party-pop flex flex-col gap-1.5 rounded-[var(--radius-xl)] border-2 border-[var(--border-accent)] bg-[var(--surface-1)] p-5 shadow-[var(--shadow-2),var(--glow-accent)]"
    >
      <Confetti fire={won} />
      <h2 className="m-0 font-display text-xl font-bold text-[var(--text-primary)]">
        {t("daily.challenge.title", { name })}
      </h2>
      <p className="m-0 text-[var(--text-secondary)]">
        {theirs.rank !== null
          ? t("daily.challenge.theirScoreRanked", {
              name,
              score,
              rank: theirs.rank,
              count: standing.finished,
            })
          : t("daily.challenge.theirScore", { name, score })}
      </p>
      <p className="m-0 font-bold text-[var(--text-primary)]">{verdict}</p>
    </section>
  );
}

function RunSkeleton() {
  return (
    <div className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-subtle)] shadow-[var(--shadow-3)]">
      <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-2)] px-5 py-3">
        <Skeleton width="8rem" height="1.2rem" rounded="pill" />
      </div>
      <div className="bg-[var(--surface-inset)] p-5">
        <Skeleton height="22rem" rounded="lg" />
      </div>
    </div>
  );
}

export function DailyPage({ gameId }: { gameId: string }) {
  const meta = getDailyMeta(gameId);
  if (!meta) return <UnknownDaily />;
  return <DailyGame key={gameId} meta={meta} />;
}

function UnknownDaily() {
  const { t } = useTranslation();
  return (
    <main id="main-content" className="app-container">
      <BackLink />
      <Notice tone="danger">{t("errors.unknown_game")}</Notice>
    </main>
  );
}

function DailyGame({ meta }: { meta: DailyGameMeta }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const gameName = useGameName();
  const { player, notifyUnauthorized } = useSession();
  const now = useNow();
  const { today, loading, loadError, error, closedDay, starting, reload, start, send, finish } =
    useDailyRun(meta.id, notifyUnauthorized);

  // The chart follows today until the player steps to another day, and snaps
  // back when today turns over.
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  useEffect(() => setPickedDay(null), [today?.day]);
  const chartDay = pickedDay ?? today?.day ?? null;
  const {
    chart,
    error: chartError,
    reload: reloadChart,
  } = useDailyChart(meta.id, chartDay, notifyUnauthorized);

  // A run that has just ended is on the chart now: show it there.
  const runStatus = today?.run?.status;
  useEffect(() => {
    if (runStatus === "done") void reloadChart();
  }, [runStatus, reloadChart]);
  // So may the player's achievements be, once the run is in the index too.
  useCheckWhenDone(runStatus);

  const challenge = useChallenge(meta.id, player?.playerId);

  const name = gameName(meta.id, meta.name);
  const run = today?.run ?? null;
  const Lazy = getLazyUi(meta.id);

  let main;
  if (loading) {
    main = <RunSkeleton />;
  } else if (loadError !== null || !today) {
    main = (
      <Notice tone="danger" action={{ label: t("retry"), onClick: () => void reload() }}>
        {errorText(t, loadError, t("daily.loadFailed"))}
      </Notice>
    );
  } else if (!run) {
    main = <StartCard starting={starting} error={error} onStart={() => void start()} />;
  } else {
    // Once the run is over, what it scored is the news, so it comes first and
    // the final board below it.
    main = (
      <>
        {run.status === "done" && (
          <RunResult run={run} meta={meta} name={name} chart={chart} now={now} />
        )}
        <GameSurface title={name}>
          <GameErrorBoundary
            key={meta.id}
            fallback={<Notice tone="danger">{t("match.failed")}</Notice>}
          >
            <Suspense
              fallback={
                <div role="status">
                  <span className="sr-only">{t("match.loadingGame")}</span>
                  <Skeleton height="22rem" rounded="lg" />
                </div>
              }
            >
              {Lazy && <Lazy view={run.view} status={run.status} send={send} />}
            </Suspense>
          </GameErrorBoundary>
        </GameSurface>
        {error !== null && (
          <Notice tone="danger" role="status">
            {errorText(t, error, t("daily.moveFailed"))}
          </Notice>
        )}
        {run.status === "active" && <EndRun onEnd={finish} />}
      </>
    );
  }

  return (
    <main id="main-content" className="app-container">
      <BackLink />
      <header className="party-pop mb-6 flex flex-wrap items-center gap-3">
        <GameGlyph gameId={meta.id} className="size-12" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="m-0 truncate font-display text-2xl font-bold text-[var(--text-primary)]">
            {name}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-[var(--radius-pill)] px-2 py-0.5 text-xs font-bold"
              style={{ background: "var(--party-pink-soft)", color: "var(--party-pink-on-soft)" }}
            >
              {t("daily.chip")}
            </span>
            {today && (
              <span className="text-sm text-[var(--text-muted)]">
                {dayLabel(language, today.day)}
              </span>
            )}
          </div>
        </div>
        {today && (
          <span className="text-xs font-semibold text-[var(--text-muted)]">
            {t("daily.newBoard", { when: relativeTime(language, today.endsAt, now) })}
          </span>
        )}
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          {closedDay && <Notice tone="info">{t("daily.dayOver")}</Notice>}
          {challenge && today && (
            <ChallengeCard standing={challenge} meta={meta} today={today.day} run={run} />
          )}
          {main}
        </div>
        {today && chartDay && (
          <DailyChart
            meta={meta}
            day={chartDay}
            today={today.day}
            chart={chart}
            error={chartError}
            myPlayerId={player?.playerId ?? ""}
            onDayChange={(day) => setPickedDay(day === today.day ? null : day)}
            onRetry={() => void reloadChart()}
          />
        )}
      </div>
    </main>
  );
}
