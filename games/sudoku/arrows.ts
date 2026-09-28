import { step } from "./game";

export const ARROWS: Record<string, [dRow: number, dCol: number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

// Where an arrow takes the selection: one square along, or to the first
// square when nothing is selected yet.
export function moveFrom(selected: number | null, [dRow, dCol]: [number, number]): number {
  return selected === null ? 0 : step(selected, dRow, dCol);
}
