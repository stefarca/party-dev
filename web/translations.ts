/// <reference types="vite/types/importMeta.d.ts" />
// Only Vite's `import.meta` types, not all of `vite/client`: that would also declare `*.css`
// modules, and game UIs must not be able to import a stylesheet.

import type { Resource } from "i18next";

// Every translated string the client can show, and nothing that touches the DOM, so Vitest can
// check the files in Node.
//
// `web/locales/<lng>.json` holds the app's own strings, namespace `common`.
// `games/<id>/locales/<lng>.json` holds one game's strings, namespace `<id>`, next to the rest
// of that game. Nothing lists these files. Adding one ships it.
//
// They are bundled eagerly: a few kilobytes in all, and it keeps a language switch synchronous,
// with no loading state in the middle of a match.
const files = import.meta.glob<Record<string, unknown>>(
  ["./locales/*.json", "../games/*/locales/*.json"],
  { eager: true, import: "default" },
);

export const FALLBACK_LANGUAGE = "en";

export const resources: Resource = {};
for (const [path, strings] of Object.entries(files)) {
  const match = path.match(/(?:\/games\/([^/]+))?\/locales\/([^/]+)\.json$/);
  if (!match) continue;
  const [, gameId, language] = match;
  (resources[language] ??= {})[gameId ?? "common"] = strings;
}

// The languages a player can pick: those the app's own strings exist in, English first. A game
// that lacks one of them shows its English strings.
export const LANGUAGES: string[] = Object.keys(resources)
  .filter((language) => "common" in resources[language])
  .sort((a, b) =>
    a === FALLBACK_LANGUAGE ? -1 : b === FALLBACK_LANGUAGE ? 1 : a.localeCompare(b),
  );

export const NAMESPACES: string[] = [
  ...new Set(Object.values(resources).flatMap((namespaces) => Object.keys(namespaces))),
];

// The first of `preferred` (a browser's `navigator.languages`, say) that the app speaks, matched
// on the base language so `it-IT` picks `it`; English if none is.
export function matchLanguage(preferred: readonly string[]): string {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split("-")[0];
    if (LANGUAGES.includes(base)) return base;
  }
  return FALLBACK_LANGUAGE;
}
