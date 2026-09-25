export function FlagGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        d="M8.5 4v15.5M5 19.5h7.5"
        fill="none"
        stroke="var(--board-peg)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path d="M9.5 4.2 19 8.2l-9.5 4z" fill="var(--seat-1)" strokeLinejoin="round" />
    </svg>
  );
}
