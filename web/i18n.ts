import i18next from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";

import type commonStrings from "./locales/en.json";
import { FALLBACK_LANGUAGE, LANGUAGES, NAMESPACES, matchLanguage, resources } from "./translations";

// Types every `t()` call against the English strings, so a missing key is a type error. Each
// game declares its own namespace the same way, at the top of its `ui.tsx`.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
  }
  interface ResourceNamespaceMap {
    common: typeof commonStrings;
  }
}

export const LANGUAGE_STORAGE_KEY = "party-language";

function readStoredLanguage(): string | null {
  try {
    const raw = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (raw && LANGUAGES.includes(raw)) return raw;
  } catch {
    // localStorage can throw (e.g. Safari private mode) — fall through to the browser's languages.
  }
  return null;
}

function browserLanguages(): readonly string[] {
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

// A language picked in the app wins, then the browser's preferences, then English. Every string
// is already bundled, so `initAsync: false` finishes this before the first render.
void i18next.use(initReactI18next).init({
  resources,
  lng: readStoredLanguage() ?? matchLanguage(browserLanguages()),
  fallbackLng: FALLBACK_LANGUAGE,
  supportedLngs: LANGUAGES,
  ns: NAMESPACES,
  defaultNS: "common",
  // React already escapes everything it renders.
  interpolation: { escapeValue: false },
  initAsync: false,
});

// Screen readers pick their pronunciation from `<html lang>`.
document.documentElement.lang = i18next.resolvedLanguage ?? FALLBACK_LANGUAGE;
i18next.on("languageChanged", (language) => {
  document.documentElement.lang = language;
});

export function setLanguage(language: string): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Best-effort persistence only — a throwing localStorage must not block the switch.
  }
  void i18next.changeLanguage(language);
}

// The language the app is showing, re-rendering the caller when the player switches.
export function useLanguage(): string {
  const { i18n } = useTranslation();
  return i18n.resolvedLanguage ?? FALLBACK_LANGUAGE;
}

// A game's display name is the `name` string in its own namespace, in the first of the player's
// languages that has one. `fallback` covers a game that ships no strings, and should be the
// English name the server reports.
export function useGameName(): (gameId: string, fallback?: string) => string {
  const { i18n } = useTranslation();
  return (gameId, fallback = gameId) => {
    for (const language of i18n.languages) {
      const name: unknown = i18n.getResource(language, gameId, "name");
      if (typeof name === "string") return name;
    }
    return fallback;
  };
}
