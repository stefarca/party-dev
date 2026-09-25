export function MineGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[72%]">
      <path
        d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"
        stroke="var(--seat-1-contrast)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="6" fill="var(--seat-1-contrast)" />
      <circle cx="10" cy="10" r="1.7" fill="var(--board-peg)" />
    </svg>
  );
}
