// Hardcoded for now. Plan 04 replaces the *body* of this file so the catalog
// is derived from the real game registry (games/registry.ts, PLAN.md §9),
// but must keep this exact public surface — GameMeta, GAME_CATALOG,
// getGameMeta — since worker/api.ts and worker/match.ts depend on it.
export interface GameMeta {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
}

export const GAME_CATALOG: GameMeta[] = [
  { id: "connect4", name: "Connect 4", minPlayers: 2, maxPlayers: 2 },
  { id: "trivia", name: "Trivia", minPlayers: 2, maxPlayers: 8 },
];

export function getGameMeta(id: string): GameMeta | undefined {
  return GAME_CATALOG.find((game) => game.id === id);
}
