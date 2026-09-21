// Pimpom's buddy: a soft winking blob, and the app's whole logo. The same
// geometry is drawn as literals in public/favicon.svg and public/icon.svg —
// keep the three in step, or the mark in the header and the mark on a home
// screen drift apart.
//
// The body is `currentColor` so a caller tints it with a text utility; the
// face is `--text-on-accent`, the one ink the palette guarantees is readable
// on `--accent` in both themes. That pairing is the reason every call site
// below tints the buddy with `text-accent` — tinting it any other colour
// would leave the face unaudited.
export function Buddy({
  className = "size-6 text-current",
  animated = false,
}: {
  className?: string;
  animated?: boolean;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <g
        // The idle bob squashes on the way down, so the buddy reads as a
        // character landing rather than a logo sliding;
        // `prefers-reduced-motion` flattens it globally.
        style={
          animated
            ? {
                animation: "party-buddy-bob 2.8s var(--ease-out) infinite",
                transformOrigin: "50% 88%",
              }
            : undefined
        }
      >
        <g transform="rotate(-7 12 12)">
          <rect x="2.6" y="4.2" width="18.8" height="16.4" rx="7" />
          <circle cx="8.8" cy="11.4" r="1.8" fill="var(--text-on-accent)" />
          <path
            d="M13.6 11.7a2.7 2.7 0 0 1 3.6 0"
            fill="none"
            stroke="var(--text-on-accent)"
            strokeWidth="1.85"
            strokeLinecap="round"
          />
          <path
            d="M9.4 15.2a3.1 3.1 0 0 0 5.6 0"
            fill="none"
            stroke="var(--text-on-accent)"
            strokeWidth="1.95"
            strokeLinecap="round"
          />
        </g>
      </g>
    </svg>
  );
}

// The logotype. Two syllables, two tones — the second one carries the accent
// the buddy is tinted with, which is what ties the word to the mark. Not
// translated and not a heading on its own: it is the product's name, and the
// callers decide what element it sits in.
export function BrandName({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display font-bold tracking-tight ${className}`}>
      pim<span className="text-accent">pom</span>
    </span>
  );
}
