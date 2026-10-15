import { useCallback, useRef, useState } from "react";

import { getDailyGame } from "../games/registry";
import type { DailyGameModule, DailyScore } from "../shared/game";
import type { DailyRunStatus } from "../shared/protocol";

// A practice board: a daily game played again, on a board of its own, just
// for fun. It runs entirely in this browser — the game's rules are the same
// pure module `DailyDO` runs — and nothing about it ever reaches the server,
// so it can never land on a chart, a streak, an achievement or the recap.
//
// Its seed is random, never the day's: a practice board dealt from the day's
// seed would be today's board without the stakes. Because nothing rides on
// it, the state (PRNG included) may sit in the page and in `localStorage`,
// where it keeps a board in progress across a reload. Storage is per player
// and per game, and every read and write tolerates storage that throws or
// holds something this build cannot read; either just means a new board.

type Module = DailyGameModule<unknown, unknown>;

interface Saved {
  state: unknown;
}

export interface PracticeRun {
  view: unknown;
  status: DailyRunStatus;
  score: DailyScore;
}

export interface PracticeState {
  run: PracticeRun | null;
  // Counts the boards dealt on this page, so the game's UI can be remounted
  // with none of the last board's local state.
  board: number;
  send: (action: unknown) => void;
  // Deals a fresh board, dropping the one in play.
  newBoard: () => void;
}

const STORAGE_PREFIX = "party-practice";

function storageKey(gameId: string, playerId: string): string {
  return `${STORAGE_PREFIX}:${playerId}:${gameId}`;
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

function load(key: string): Saved | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved;
    return saved && typeof saved === "object" && "state" in saved ? saved : null;
  } catch {
    return null;
  }
}

function store(key: string, saved: Saved): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(saved));
  } catch {
    // Storage full or blocked: the board still plays, it just won't survive a reload.
  }
}

// Whether `playerId` has a practice board under way at `gameId`, for the
// button that offers one to say "continue" rather than "play again".
export function hasPracticeInProgress(gameId: string, playerId: string): boolean {
  const module = getDailyGame(gameId) as Module | undefined;
  const saved = load(storageKey(gameId, playerId));
  if (!module || !saved) return false;
  try {
    return !module.finished(saved.state);
  } catch {
    return false;
  }
}

// What the game's UI needs of `state`, or null when this build cannot read
// it: a board saved by an older version of the game, say.
function runOf(module: Module, state: unknown): PracticeRun | null {
  try {
    const view = module.view(state);
    const status: DailyRunStatus = module.finished(state) ? "done" : "active";
    let score: DailyScore;
    try {
      score = module.score(state);
    } catch {
      score = { value: null };
    }
    return { view, status, score };
  } catch {
    return null;
  }
}

function deal(module: Module): Saved {
  return { state: module.init(randomSeed(), Date.now()) };
}

export function usePracticeRun(gameId: string, playerId: string): PracticeState {
  const module = getDailyGame(gameId) as Module | undefined;
  const key = storageKey(gameId, playerId);

  // The board in play, read synchronously by `send` so that moves made faster
  // than React renders each apply to the one before.
  const current = useRef<Saved | null>(null);
  const [board, setBoard] = useState(0);
  const [run, setRun] = useState<PracticeRun | null>(() => {
    if (!module) return null;
    const saved = load(key);
    const resumed = saved ? runOf(module, saved.state) : null;
    if (saved && resumed) {
      current.current = saved;
      return resumed;
    }
    const fresh = deal(module);
    store(key, fresh);
    current.current = fresh;
    return runOf(module, fresh.state);
  });

  const send = useCallback(
    (action: unknown) => {
      const saved = current.current;
      if (!module || !saved) return;
      if (module.finished(saved.state)) return;
      const parsed = module.actionSchema.safeParse(action);
      if (!parsed.success) return;
      let next: unknown;
      try {
        next = module.reduce(saved.state, parsed.data, Date.now());
      } catch {
        // An illegal move: the board stays as it was, as it would on the server.
        return;
      }
      const updated = { state: next };
      current.current = updated;
      store(key, updated);
      setRun(runOf(module, next));
    },
    [module, key],
  );

  const newBoard = useCallback(() => {
    if (!module) return;
    const fresh = deal(module);
    current.current = fresh;
    store(key, fresh);
    setRun(runOf(module, fresh.state));
    setBoard((n) => n + 1);
  }, [module, key]);

  return { run, board, send, newBoard };
}
