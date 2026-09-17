import { useSyncExternalStore } from "react";

// Same store shape as web/router.tsx: a module-level listener Set, an
// emitChange(), and useSyncExternalStore — no context provider.

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "party-theme";

const LIGHT_QUERY = "(prefers-color-scheme: light)";

function readStoredPreference(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "system" || raw === "light" || raw === "dark") return raw;
  } catch {
    // localStorage can throw (e.g. Safari private mode) — fall through to the default.
  }
  return "system";
}

function prefersLight(): boolean {
  try {
    return window.matchMedia(LIGHT_QUERY).matches;
  } catch {
    return false;
  }
}

function resolve(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") return prefersLight() ? "light" : "dark";
  return preference;
}

function apply(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved;
  // HeroUI's dark-mode variant matches either `.dark`/`[data-theme="dark"]` —
  // set both so it's driven by this one switch.
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.classList.toggle("light", resolved === "light");
}

let preference: ThemePreference = readStoredPreference();
let resolved: ResolvedTheme = resolve(preference);
apply(resolved);

type Listener = () => void;
const listeners = new Set<Listener>();

function emitChange(): void {
  for (const listener of listeners) listener();
}

let mediaQuery: MediaQueryList | null = null;

function handleMediaChange(): void {
  if (preference !== "system") return;
  const next = resolve(preference);
  if (next === resolved) return;
  resolved = next;
  apply(resolved);
  emitChange();
}

function ensureMediaSubscription(): void {
  if (mediaQuery || listeners.size === 0) return;
  try {
    mediaQuery = window.matchMedia(LIGHT_QUERY);
    mediaQuery.addEventListener("change", handleMediaChange);
  } catch {
    mediaQuery = null;
  }
}

function releaseMediaSubscriptionIfUnused(): void {
  if (!mediaQuery || listeners.size > 0) return;
  mediaQuery.removeEventListener("change", handleMediaChange);
  mediaQuery = null;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  ensureMediaSubscription();
  return () => {
    listeners.delete(listener);
    releaseMediaSubscriptionIfUnused();
  };
}

export function getThemePreference(): ThemePreference {
  return preference;
}

export function setThemePreference(next: ThemePreference): void {
  preference = next;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Best-effort persistence only — a throwing localStorage must not block the theme change.
  }
  const nextResolved = resolve(preference);
  if (nextResolved !== resolved) {
    resolved = nextResolved;
    apply(resolved);
  }
  emitChange();
}

function getPreferenceSnapshot(): ThemePreference {
  return preference;
}

function getResolvedSnapshot(): ResolvedTheme {
  return resolved;
}

function getServerSnapshot(): ThemePreference {
  return "system";
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, getPreferenceSnapshot, getServerSnapshot);
}

export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, getResolvedSnapshot, () => "dark");
}
