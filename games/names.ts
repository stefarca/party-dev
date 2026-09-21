/// <reference types="vite/types/importMeta.d.ts" />
// Only Vite's `import.meta` types, for the glob below — the same narrow
// reference web/translations.ts uses, and for the same reason.

import { getDailyMeta, getGameMeta } from "./catalog";

// A game's display name in one language, for the Worker.
//
// The client reads the same names through i18next (`useGameName()`), out of
// the very same files. The Worker cannot: it has no i18next, and a game UI's
// namespace is client-only. But a notification is a player-facing string, so
// "Forza 4" has to reach an Italian player's lock screen exactly as it
// reaches their screen. Globbing the `name` key out of every game's locale
// files is what keeps those two readings the same file.
//
// Eager, like the client's: it is a handful of bytes per game, and the
// alternative is an await on the way to composing a notification.
const files = import.meta.glob<Record<string, unknown>>("./*/locales/*.json", {
  eager: true,
  import: "default",
});

// `${gameId}:${language}` -> that game's name in that language.
const names = new Map<string, string>();
for (const [path, strings] of Object.entries(files)) {
  const match = path.match(/^\.\/([^/]+)\/locales\/([^/]+)\.json$/);
  if (!match) continue;
  const name = strings.name;
  if (typeof name === "string") names.set(`${match[1]}:${match[2]}`, name);
}

// `gameId`'s name in `language`, falling back the way the client does: to
// English, and then to the catalog's own name for a game that ships no
// strings at all (which is the English name the server reports for it).
export function gameName(gameId: string, language: string): string {
  return (
    names.get(`${gameId}:${language}`) ??
    names.get(`${gameId}:en`) ??
    getGameMeta(gameId)?.name ??
    getDailyMeta(gameId)?.name ??
    gameId
  );
}
