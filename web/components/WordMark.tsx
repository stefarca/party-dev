// A generic diamond-of-tiles glyph next to the "party-dev" wordmark — no
// game-specific imagery, just an abstract mark for the brand itself.
export function WordMark({ className = "app-mark" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" opacity="0.7" />
      <rect x="3" y="14" width="7" height="7" rx="2" opacity="0.7" />
      <rect x="14" y="14" width="7" height="7" rx="2" opacity="0.45" />
    </svg>
  );
}
