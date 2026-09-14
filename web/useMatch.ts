import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, getMatchSnapshot, postMatchAction, postMatchStart } from "./api";
import type { MatchEvent, MatchSnapshot, ServerMessage } from "../shared/protocol";

// The live match transport: "treat WS as an
// optimization over 'fetch state on load', never as the only path". This
// hook always fetches the HTTP snapshot first and renders it immediately,
// then opens a WebSocket as a pure add-on. If the socket never opens (or
// keeps failing), the page is still fully usable — `send`/`start` fall back
// to the HTTP routes and the caller never needs to know which transport was
// used.
//
// Every mutable piece of transport state (the socket, timers, backoff
// counters, the highest seq seen so far) lives in a ref, not `useState` —
// it is read and written from WebSocket event callbacks and setTimeout
// callbacks that must never operate on a stale closure, and updating it must
// never itself trigger a render.

export type ConnectionState = "connecting" | "live" | "offline";

export interface MatchError {
  code: string;
  message: string;
}

export interface UseMatchResult {
  snapshot: MatchSnapshot | null;
  events: MatchEvent[];
  connection: ConnectionState;
  error: MatchError | null;
  send: (action: unknown) => void;
  start: () => void;
}

const MAX_HISTORY = 200;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

// Error codes that arrive before a socket's first `hello` round trip has
// ever succeeded, and mean "this connection will never work" rather than
// "this particular action failed" — no amount of reconnecting fixes a match
// that does not exist or a player who is not in it, so the reconnect loop
// stops rather than backing off forever.
const FATAL_ERROR_CODES = new Set(["not_found", "not_a_player", "no_identity"]);

function toMatchError(err: unknown, fallbackCode: string, fallbackMessage: string): MatchError {
  if (err instanceof ApiError) return { code: err.code, message: err.message };
  return { code: fallbackCode, message: err instanceof Error ? err.message : fallbackMessage };
}

export function useMatch(
  matchId: string,
  ready: boolean,
  onUnauthorized?: () => void,
): UseMatchResult {
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [error, setError] = useState<MatchError | null>(null);

  // Highest `seq` seen so far, across both transports — sent as `since` on
  // every `hello`. A plain ref (not derived from `snapshot` state) so the
  // WS message handler always reads the latest value even mid-render.
  const sinceRef = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffAttemptRef = useRef(0);
  const matchIdRef = useRef(matchId);
  matchIdRef.current = matchId;
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  // Replaces the rendered snapshot, guarding against this case: a
  // snapshot that arrives out of order after a reconnect (e.g. a slow HTTP
  // fetch that resolves after the WS's own `hello` reply already landed)
  // must never clobber newer state.
  const applySnapshot = useCallback((next: MatchSnapshot) => {
    setSnapshot((prev) => (prev && next.seq < prev.seq ? prev : next));
    if (next.seq > sinceRef.current) sinceRef.current = next.seq;
  }, []);

  // Appends to the bounded history buffer. De-duplicates by `seq` and sorts
  // ascending — the server's own contract already guarantees a contiguous,
  // gap-free range for one `hello` reply, but this is cheap insurance
  // against, say, the HTTP action fallback's snapshot racing a WS `events`
  // batch that covers the same range.
  const applyEvents = useCallback((incoming: MatchEvent[]) => {
    if (incoming.length === 0) return;
    setEvents((prev) => {
      const seen = new Set(prev.map((e) => e.seq));
      const merged = prev.concat(incoming.filter((e) => !seen.has(e.seq)));
      merged.sort((a, b) => a.seq - b.seq);
      return merged.length > MAX_HISTORY ? merged.slice(merged.length - MAX_HISTORY) : merged;
    });
    for (const e of incoming) {
      if (e.seq > sinceRef.current) sinceRef.current = e.seq;
    }
  }, []);

  useEffect(() => {
    // A visitor who just landed on a lobby they aren't a member of yet is
    // joined asynchronously by the caller (MatchPage's `load()`) before this
    // becomes true. Connecting eagerly would race that join: the very first
    // `/view` fetch below would 403 as `not_a_player`, which this hook (for
    // good reason — a match that will never exist doesn't get better on
    // retry) treats as fatal and never reconnects from, even once the join
    // completes moments later. Simply not connecting until membership is
    // confirmed avoids the race entirely rather than trying to distinguish
    // "permanently not a player" from "not a player yet".
    if (!ready) return;

    let cancelled = false;
    let fatal = false;

    // Fresh transport state for this matchId — reset explicitly rather than
    // relying on initial values, since this effect also re-runs whenever
    // `matchId` changes (navigating from one match straight to another).
    sinceRef.current = 0;
    backoffAttemptRef.current = 0;
    setSnapshot(null);
    setEvents([]);
    setError(null);
    setConnection("connecting");

    function markFatal(err: MatchError) {
      fatal = true;
      setError(err);
      setConnection("offline");
    }

    function scheduleReconnect() {
      if (cancelled || fatal || reconnectTimerRef.current) return;
      const attempt = backoffAttemptRef.current;
      backoffAttemptRef.current = attempt + 1;
      const base = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
      // Full jitter within [base/2, base], still capped at MAX_BACKOFF_MS.
      const delay = Math.min(base / 2 + Math.random() * (base / 2), MAX_BACKOFF_MS);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    }

    function connect() {
      if (cancelled || fatal) return;
      // Guards against the mount-time flow and reconnectNow() (via
      // online/visibilitychange) racing each other: whichever caller reaches
      // connect() first wins, and the other is a no-op rather than opening a
      // second, permanently-leaked socket that overwrites socketRef.current.
      const existing = socketRef.current;
      if (
        existing &&
        (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }
      setConnection("connecting");

      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${wsProtocol}//${window.location.host}/ws/${encodeURIComponent(matchId)}`,
      );
      socketRef.current = ws;
      let helloAcked = false;

      ws.addEventListener("open", () => {
        if (cancelled) {
          ws.close();
          return;
        }
        ws.send(JSON.stringify({ t: "hello", since: sinceRef.current }));
      });

      ws.addEventListener("message", (ev) => {
        if (cancelled) return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        } catch {
          return;
        }

        switch (msg.t) {
          case "snapshot": {
            if (!helloAcked) {
              // A successful `hello` round trip — the binding reset
              // point for the backoff counter.
              helloAcked = true;
              backoffAttemptRef.current = 0;
              setConnection("live");
            }
            const { t: _t, ...rest } = msg;
            applySnapshot(rest);
            break;
          }
          case "events":
            applyEvents(msg.events);
            break;
          case "error":
            if (!helloAcked && FATAL_ERROR_CODES.has(msg.code)) {
              markFatal({ code: msg.code, message: msg.message });
              ws.close();
              return;
            }
            // Any other error (e.g. not_your_turn, invalid_action,
            // invalid_move) is transient and tied to whatever the caller
            // just tried — surface it, but the connection itself is fine.
            setError({ code: msg.code, message: msg.message });
            break;
          case "pong":
            break;
        }
      });

      ws.addEventListener("close", () => {
        if (socketRef.current === ws) socketRef.current = null;
        if (cancelled) return;
        setConnection("offline");
        if (!fatal) scheduleReconnect();
      });

      // The browser fires "error" immediately before "close" on a failed
      // connection attempt; "close" above is what schedules the reconnect,
      // so there is nothing to do here beyond not letting it throw.
      ws.addEventListener("error", () => {});
    }

    function reconnectNow() {
      if (cancelled || fatal) return;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const current = socketRef.current;
      if (
        current &&
        (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }
      connect();
    }

    // Laptop-sleep/wake case: bypass the backoff timer entirely and
    // reconnect immediately when the tab becomes visible again or the OS
    // reports the network is back.
    function onVisibilityChange() {
      if (document.visibilityState === "visible") reconnectNow();
    }
    function onOnline() {
      reconnectNow();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);

    (async () => {
      try {
        const initial = await getMatchSnapshot(matchId);
        if (cancelled) return;
        applySnapshot(initial);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          onUnauthorizedRef.current?.();
          markFatal({ code: "no_identity", message: "session expired" });
          return;
        }
        if (err instanceof ApiError && err.status === 404) {
          markFatal({ code: "not_found", message: "match not found" });
          return;
        }
        if (err instanceof ApiError && err.status === 403) {
          markFatal({ code: "not_a_player", message: "you are not a player in this match" });
          return;
        }
        // Any other failure (network hiccup, 500) is not fatal — the socket
        // may still succeed and will send its own snapshot via `hello`.
        setError(toMatchError(err, "snapshot_failed", "failed to load this match"));
      }
      if (!cancelled && !fatal) connect();
    })();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [matchId, ready, applySnapshot, applyEvents]);

  // The client never sends state, only intents — these
  // two are the only two ways this hook ever talks to the server.
  const send = useCallback(
    (action: unknown) => {
      setError(null);
      const ws = socketRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ t: "action", action }));
          return;
        } catch {
          // Fall through to the HTTP fallback below.
        }
      }
      postMatchAction(matchIdRef.current, action)
        .then((next) => applySnapshot(next))
        .catch((err) => {
          if (err instanceof ApiError && err.status === 401) {
            onUnauthorizedRef.current?.();
            return;
          }
          setError(toMatchError(err, "action_failed", "action failed"));
        });
    },
    [applySnapshot],
  );

  const start = useCallback(() => {
    setError(null);
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ t: "start" }));
        return;
      } catch {
        // Fall through to the HTTP fallback below.
      }
    }
    postMatchStart(matchIdRef.current)
      .then((next) => applySnapshot(next))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          onUnauthorizedRef.current?.();
          return;
        }
        setError(toMatchError(err, "start_failed", "could not start the match"));
      });
  }, [applySnapshot]);

  return { snapshot, events, connection, error, send, start };
}
