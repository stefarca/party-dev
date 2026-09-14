import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { ApiError, getMe, setIdentity } from "./api";
import type { Me } from "./api";

export type SessionState = "loading" | "anon" | "ready";

interface SessionValue {
  state: SessionState;
  player: Me | null;
  error: string | null;
  signIn: (nickname: string) => Promise<void>;
  rename: (nickname: string) => Promise<void>;
  retry: () => void;
  // Called by any screen whose fetch comes back 401 (e.g. the cookie
  // expired between page loads) so the app falls back to the nickname gate
  // instead of showing a raw error — see the plan's acceptance criteria.
  notifyUnauthorized: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>("loading");
  const [player, setPlayer] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setError(null);
    getMe()
      .then((me) => {
        if (cancelled) return;
        setPlayer(me);
        setState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setState("anon");
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setState("anon");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const signIn = useCallback(async (nickname: string) => {
    const me = await setIdentity(nickname);
    setPlayer(me);
    setError(null);
    setState("ready");
  }, []);

  const rename = useCallback(async (nickname: string) => {
    const me = await setIdentity(nickname);
    setPlayer(me);
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const notifyUnauthorized = useCallback(() => {
    setPlayer(null);
    setState("anon");
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ state, player, error, signIn, rename, retry, notifyUnauthorized }),
    [state, player, error, signIn, rename, retry, notifyUnauthorized],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession() called outside SessionProvider");
  }
  return value;
}
