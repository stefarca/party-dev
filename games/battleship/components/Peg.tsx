import { LAND } from "../board";

export function Peg({ hit, landing }: { hit: boolean; landing: boolean }) {
  if (!hit) {
    return (
      <span
        aria-hidden="true"
        className={`size-[30%] rounded-full bg-[var(--board-peg)] shadow-[var(--shadow-1)] ${landing ? LAND : ""}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`flex size-[58%] items-center justify-center rounded-full bg-[var(--seat-1)] text-[var(--seat-1-contrast)] shadow-[var(--game-piece-shadow)] ring-2 ring-[var(--seat-1-contrast)] ${landing ? LAND : ""}`}
    >
      <svg viewBox="0 0 24 24" className="size-3/5" fill="none" stroke="currentColor">
        <path d="M6 6 18 18M18 6 6 18" strokeWidth={4} strokeLinecap="round" />
      </svg>
    </span>
  );
}
