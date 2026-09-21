import { dailyGames, serverGames } from "./registry";
import type { DailyGameMeta as DailyModuleMeta, GameMeta as ModuleMeta } from "../shared/game";

// Derived from the real game registry (games/registry.ts). worker/api.ts
// and worker/match.ts depend on its public surface (GameMeta, GAME_CATALOG,
// getGameMeta). `GameMeta` here adds the module's own `id` to its `meta` (a
// `GameModule`'s `id` and `meta` are separate top-level fields — see
// shared/game.ts).
export interface GameMeta extends ModuleMeta {
  id: string;
}

// Never hardcode entries here — registering a game in `serverGames` is what
// lists it.
export const GAME_CATALOG: GameMeta[] = Object.values(serverGames).map((game) => ({
  id: game.id,
  ...game.meta,
}));

export function getGameMeta(id: string): GameMeta | undefined {
  return GAME_CATALOG.find((game) => game.id === id);
}

// The daily games, the same way: derived from `dailyGames`, never hardcoded.
export interface DailyGameMeta extends DailyModuleMeta {
  id: string;
}

export const DAILY_CATALOG: DailyGameMeta[] = Object.values(dailyGames).map((game) => ({
  id: game.id,
  ...game.meta,
}));

export function getDailyMeta(id: string): DailyGameMeta | undefined {
  return DAILY_CATALOG.find((game) => game.id === id);
}
