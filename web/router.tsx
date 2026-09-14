import { useSyncExternalStore } from "react";

// Hand-rolled client-side routing (~40 lines) — a router dependency is out
// of scope for this plan. Keeps a single route table so plans 05-07 can add
// routes here without touching every component that navigates.
//
// Routes:
//   /            -> dashboard
//   /m/:code     -> match/lobby page

export type Route = { name: "dashboard" } | { name: "match"; code: string } | { name: "not-found" };

function parseRoute(pathname: string): Route {
  if (pathname === "/") return { name: "dashboard" };
  const match = pathname.match(/^\/m\/([^/]+)\/?$/);
  if (match) return { name: "match", code: match[1] };
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
