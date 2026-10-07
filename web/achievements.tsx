import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import type { AchievementId } from "../shared/achievements";
import type { AchievementsResponse } from "../shared/protocol";
import { getAchievements, markAchievementsSeen } from "./api";
import { AchievementToast } from "./components/AchievementToast";

// The player's achievements on the client: the latest read of them, for the stats page, and the
// announcement of any level they have not been told about yet, wherever in the app they are.
//
// Achievements are worked out from the match index, which a finished match reaches a moment
// after its page hears it finished. So a page that sees something finish asks for a check soon
// rather than now, and asks once more a little later if the first found nothing new.
//
// A level is announced once: the server remembers what each player has been told, so a second
// device does not repeat it, and this remembers what it has announced since it mounted, so a
// write of that which fails does not either, not until the next load.

export interface Unlock {
  id: AchievementId;
  level: number;
}

interface AchievementsValue {
  data: AchievementsResponse | null;
  error: unknown;
  // Reads them again, and announces whatever is new.
  refresh: () => Promise<void>;
  // The same, after a match or a daily run finishes.
  checkSoon: () => void;
}

const CHECK_DELAYS_MS = [1500, 5000];

const AchievementsContext = createContext<AchievementsValue | null>(null);

// The levels in `data` the player has not been told about, by the server or by this page, the
// most recently reached first.
function unlocksIn(data: AchievementsResponse, announced: Map<AchievementId, number>): Unlock[] {
  return data.achievements
    .filter((a) => a.unlockedAt.length > Math.max(data.seen[a.id] ?? 0, announced.get(a.id) ?? 0))
    .sort((a, b) => b.unlockedAt[b.unlockedAt.length - 1] - a.unlockedAt[a.unlockedAt.length - 1])
    .map((a) => ({ id: a.id, level: a.unlockedAt.length }));
}

export function AchievementsProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AchievementsResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [shown, setShown] = useState<Unlock[]>([]);
  const announced = useRef(new Map<AchievementId, number>());
  const inFlight = useRef<Promise<AchievementsResponse | null> | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  // One read at a time: whoever asks while one is under way gets that one.
  const load = useCallback(() => {
    inFlight.current ??= getAchievements()
      .then(
        (next) => {
          setData(next);
          setError(null);
          return next;
        },
        (err: unknown) => {
          setError(err);
          return null;
        },
      )
      .finally(() => {
        inFlight.current = null;
      });
    return inFlight.current;
  }, []);

  // Announces what is new in `next`, and says whether there was anything.
  const announce = useCallback((next: AchievementsResponse): boolean => {
    const fresh = unlocksIn(next, announced.current);
    if (fresh.length === 0) return false;
    for (const unlock of fresh) announced.current.set(unlock.id, unlock.level);
    // A toast already up gains the new ones rather than being replaced by them.
    setShown((current) => [...fresh, ...current.filter((u) => !fresh.some((f) => f.id === u.id))]);
    markAchievementsSeen(Object.fromEntries(fresh.map((u) => [u.id, u.level]))).catch(
      (err: unknown) => console.error("could not record the achievements announced", err),
    );
    return true;
  }, []);

  const refresh = useCallback(async () => {
    const next = await load();
    if (next) announce(next);
  }, [load, announce]);

  const checkSoon = useCallback(() => {
    const pending = timers.current;
    for (const timer of pending) clearTimeout(timer);
    pending.clear();
    let found = false;
    for (const delay of CHECK_DELAYS_MS) {
      const timer = setTimeout(() => {
        pending.delete(timer);
        if (found) return;
        void load().then((next) => {
          if (next && announce(next)) found = true;
        });
      }, delay);
      pending.add(timer);
    }
  }, [load, announce]);

  useEffect(() => {
    void refresh();
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, [refresh]);

  const close = useCallback(() => setShown([]), []);

  const value = useMemo<AchievementsValue>(
    () => ({ data, error, refresh, checkSoon }),
    [data, error, refresh, checkSoon],
  );

  return (
    <AchievementsContext.Provider value={value}>
      {children}
      <AchievementToast unlocks={shown} onClose={close} />
    </AchievementsContext.Provider>
  );
}

export function useAchievements(): AchievementsValue {
  const value = useContext(AchievementsContext);
  if (!value) {
    throw new Error("useAchievements() called outside AchievementsProvider");
  }
  return value;
}

// Asks for a check once `status` turns to "done" while the page is open. A page that opens on
// something already over has nothing new to check for: the provider read everything as it
// mounted.
export function useCheckWhenDone(status: string | undefined): void {
  const { checkSoon } = useAchievements();
  const previous = useRef(status);
  useEffect(() => {
    if (status === "done" && previous.current !== undefined && previous.current !== "done") {
      checkSoon();
    }
    previous.current = status;
  }, [status, checkSoon]);
}
