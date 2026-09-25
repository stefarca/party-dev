// The browser's frame clock and motion preference, reached through a narrow
// type of its own: the Worker's type-check of this game has no DOM.

interface FrameClock {
  requestAnimationFrame(callback: (time: number) => void): number;
  cancelAnimationFrame(handle: number): void;
  matchMedia?(query: string): { matches: boolean };
}

export const frameClock = globalThis as unknown as FrameClock;

export function prefersReducedMotion(): boolean {
  return frameClock.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
