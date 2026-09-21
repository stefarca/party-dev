import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  finishDailyRun,
  getDailyChart,
  getDailyToday,
  postDailyAction,
  startDailyRun,
} from "./api";
import type { DailyChart, DailyRunSnapshot, DailyToday } from "../shared/protocol";

// The daily games' two live reads: today's run at one game, and a day's chart
// for it. Both are plain HTTP. A run has one player, so nothing but that
// player's own requests ever changes it, and each reply is the whole run as
// it stands. A chart changes as other players finish, which a poll covers.

// Actions are posted one at a time, in the order they were made: a player
// sliding tiles as fast as they can press keys must never have two moves
// reach the server the other way round. The queue is short, so a key held
// down on a slow connection cannot bank a minute of moves.
const MAX_QUEUED = 4;

// How often an open chart re-reads while the page is visible.
const CHART_POLL_MS = 20_000;

export interface DailyRunState {
  today: DailyToday | null;
  loading: boolean;
  loadError: unknown;
  // The last start or move that failed, for the page to report.
  error: unknown;
  // The day whose board closed under a run still going, until the player
  // starts another.
  closedDay: string | null;
  starting: boolean;
  reload: () => Promise<void>;
  start: () => Promise<void>;
  send: (action: unknown) => void;
  // Throws when it fails, for the confirm dialog that called it to report.
  finish: () => Promise<void>;
}

export function useDailyRun(gameId: string, onUnauthorized: () => void): DailyRunState {
  const [today, setToday] = useState<DailyToday | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);
  const [closedDay, setClosedDay] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // Read from async callbacks, which must never act on a stale closure.
  const todayRef = useRef<DailyToday | null>(null);
  todayRef.current = today;
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  const queue = useRef<unknown[]>([]);
  // Settles once every queued action has been posted.
  const drained = useRef<Promise<void> | null>(null);

  // True when `err` was a lapsed session, which the app handles for us.
  const unauthorized = useCallback((err: unknown): boolean => {
    if (err instanceof ApiError && err.status === 401) {
      onUnauthorizedRef.current();
      return true;
    }
    return false;
  }, []);

  const setRun = useCallback((run: DailyRunSnapshot) => {
    setToday((prev) => (prev && prev.day === run.day ? { ...prev, run } : prev));
  }, []);

  const reload = useCallback(async () => {
    try {
      setToday(await getDailyToday(gameId));
      setLoadError(null);
    } catch (err) {
      if (!unauthorized(err)) setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [gameId, unauthorized]);

  useEffect(() => {
    setLoading(true);
    setToday(null);
    queue.current = [];
    void reload();
  }, [reload]);

  // Midnight: the run on screen belongs to a day that just closed. Reloading
  // shows the new day, and a run that was still going gets a word about
  // where it went.
  const endsAt = today?.endsAt;
  useEffect(() => {
    if (endsAt === undefined) return;
    const timer = setTimeout(
      () => {
        const current = todayRef.current;
        if (current?.run?.status === "active") setClosedDay(current.day);
        void reload();
      },
      Math.max(0, endsAt - Date.now()) + 1000,
    );
    return () => clearTimeout(timer);
  }, [endsAt, reload]);

  const drain = useCallback(async () => {
    let run = todayRef.current?.run ?? null;
    while (queue.current.length > 0 && run?.status === "active") {
      const action = queue.current.shift();
      try {
        run = await postDailyAction(gameId, run.day, action);
        setRun(run);
      } catch (err) {
        queue.current = [];
        if (unauthorized(err)) return;
        if (err instanceof ApiError && err.code === "day_over") setClosedDay(run.day);
        else setError(err);
        // Whatever went wrong, show the run as the server has it.
        await reload();
        return;
      }
    }
    // Anything still queued was made against a run that has since ended.
    queue.current = [];
  }, [gameId, reload, setRun, unauthorized]);

  const send = useCallback(
    (action: unknown) => {
      if (queue.current.length >= MAX_QUEUED) return;
      queue.current.push(action);
      setError(null);
      if (!drained.current) {
        drained.current = drain().finally(() => {
          drained.current = null;
        });
      }
    },
    [drain],
  );

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    setClosedDay(null);
    try {
      setToday(await startDailyRun(gameId));
    } catch (err) {
      if (!unauthorized(err)) setError(err);
    } finally {
      setStarting(false);
    }
  }, [gameId, unauthorized]);

  const finish = useCallback(async () => {
    // Moves already sent land first; ones not yet sent are dropped, since the
    // player has just said they are done.
    queue.current = [];
    await drained.current;
    const run = todayRef.current?.run;
    if (!run || run.status !== "active") return;
    try {
      setRun(await finishDailyRun(gameId, run.day));
    } catch (err) {
      if (!unauthorized(err)) throw err;
    }
  }, [gameId, setRun, unauthorized]);

  return { today, loading, loadError, error, closedDay, starting, reload, start, send, finish };
}

export interface DailyChartState {
  chart: DailyChart | null;
  error: unknown;
  reload: () => Promise<void>;
}

// `day`'s chart for `gameId`, re-read on a poll while the page is visible and
// whenever it becomes visible again. Null `day` waits: the page learns what
// today is from the server first.
export function useDailyChart(
  gameId: string,
  day: string | null,
  onUnauthorized: () => void,
): DailyChartState {
  const [chart, setChart] = useState<DailyChart | null>(null);
  const [error, setError] = useState<unknown>(null);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  // The day asked for last. A reply for any other — the player stepped past
  // it while it was in flight — is dropped.
  const wanted = useRef(day);
  wanted.current = day;

  const reload = useCallback(async () => {
    if (!day) return;
    try {
      const next = await getDailyChart(gameId, day);
      if (wanted.current !== day) return;
      setChart(next);
      setError(null);
    } catch (err) {
      if (wanted.current !== day) return;
      if (err instanceof ApiError && err.status === 401) onUnauthorizedRef.current();
      else setError(err);
    }
  }, [gameId, day]);

  useEffect(() => {
    setChart(null);
    setError(null);
    void reload();
    const timer = setInterval(() => {
      if (!document.hidden) void reload();
    }, CHART_POLL_MS);
    function onVisible() {
      if (!document.hidden) void reload();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);

  return { chart, error, reload };
}
