import { useSyncExternalStore } from "react";

// Hand-rolled client-side routing (~40 lines) — deliberately no router
// dependency. Keeps a single route table so new routes can be added here
// without touching every component that navigates.
//
// Routes:
//   /                -> dashboard, on whichever section needs the player most
//   /matches         -> dashboard, the player's matches
//   /play            -> dashboard, the games to start and the code box
//   /daily           -> dashboard, today's daily games
//   /m/:code         -> match/lobby page
//   /daily/:gameId   -> today's run at a daily game, and its chart
//   /stats           -> the player's stats, and the week's boards

// The dashboard's sections. Each has an address of its own, so a reload or the
// back button lands on the section the player left.
export const HUB_TABS = ["matches", "play", "daily"] as const;
export type HubTab = (typeof HUB_TABS)[number];

export type Route =
  // `tab` is null at `/`, where the dashboard picks the section itself.
  | { name: "dashboard"; tab: HubTab | null }
  | { name: "match"; code: string }
  | { name: "daily"; gameId: string }
  | { name: "stats" }
  | { name: "not-found" };

function parseRoute(pathname: string): Route {
  if (pathname === "/") return { name: "dashboard", tab: null };
  const tab = pathname.match(/^\/(matches|play|daily)\/?$/);
  if (tab) return { name: "dashboard", tab: tab[1] as HubTab };
  if (/^\/stats\/?$/.test(pathname)) return { name: "stats" };
  const match = pathname.match(/^\/m\/([^/]+)\/?$/);
  if (match) return { name: "match", code: match[1] };
  const daily = pathname.match(/^\/daily\/([^/]+)\/?$/);
  if (daily) return { name: "daily", gameId: decodeURIComponent(daily[1]) };
  return { name: "not-found" };
}

type Listener = () => void;
const listeners = new Set<Listener>();

function emitChange(): void {
  for (const listener of listeners) listener();
}

// Fires on browser back/forward.
window.addEventListener("popstate", emitChange);

export function navigate(path: string, opts?: { replace?: boolean }): void {
  if (opts?.replace) {
    window.history.replaceState(null, "", path);
  } else {
    window.history.pushState(null, "", path);
  }
  emitChange();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): string {
  return window.location.pathname;
}

// Current route, re-rendering the subscribed component on navigate()/popstate.
export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, getSnapshot);
  return parseRoute(pathname);
}
