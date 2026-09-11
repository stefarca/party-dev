import { serverGames } from "./registry";
import type { GameMeta as ModuleMeta } from "../shared/game";

// Derived from the real game registry (games/registry.ts, PLAN.md §9) —
// keeps the exact public surface plan 02 established (GameMeta,
// GAME_CATALOG, getGameMeta), since worker/api.ts and worker/match.ts depend
// on it. `GameMeta` here adds the module's own `id` to its `meta` (a
// `GameModule`'s `id` and `meta` are separate top-level fields — see
// shared/game.ts).
export interface GameMeta extends ModuleMeta {
  id: string;
}

// With `serverGames` empty until plan 06 lands, this is `[]` — that is
// correct and temporary (see the plan's Risks/notes: do not re-hardcode the
// catalog to hide it).
export const GAME_CATALOG: GameMeta[] = Object.values(serverGames).map((game) => ({
  id: game.id,
  ...game.meta,
}));

export function getGameMeta(id: string): GameMeta | undefined {
  return GAME_CATALOG.find((game) => game.id === id);
}
