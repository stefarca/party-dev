import type { GameUiProps } from "../../shared/protocol";

export function nameFor(players: GameUiProps["players"], id: string): string {
  return players.find((p) => p.id === id)?.nickname ?? id;
}
