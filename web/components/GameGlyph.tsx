import type { GameMotif } from "../identity";
import { motifForId, tileGradient } from "../identity";

// The decorative badge on a game tile: an abstract motif on a two-hue party
// gradient, both picked by hashing the game's id. No game is named here and
// no per-game asset exists — registering a game gets it a look for free.

function Motif({ motif }: { motif: GameMotif }) {
  switch (motif) {
    case "dots":
      return (
        <>
          <circle cx="8" cy="8" r="3.2" />
          <circle cx="16" cy="8" r="3.2" opacity="0.65" />
          <circle cx="8" cy="16" r="3.2" opacity="0.65" />
          <circle cx="16" cy="16" r="3.2" />
        </>
      );
    case "grid":
      return (
        <>
          <rect x="4" y="4" width="7" height="7" rx="2" />
          <rect x="13" y="4" width="7" height="7" rx="2" opacity="0.6" />
          <rect x="4" y="13" width="7" height="7" rx="2" opacity="0.6" />
          <rect x="13" y="13" width="7" height="7" rx="2" />
        </>
      );
    case "bolt":
      return <path d="M13.5 2 5 13h5.5L10 22l9-11h-5.5z" />;
    case "star":
      return (
        <path d="m12 2.5 2.9 6.1 6.6.9-4.8 4.6 1.2 6.6-5.9-3.2-5.9 3.2 1.2-6.6L2.5 9.5l6.6-.9z" />
      );
    case "rings":
      return (
        <>
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" />
          <circle cx="12" cy="12" r="4" />
        </>
      );
    case "wave":
      return (
        <path
          d="M2 15c2.8 0 2.8-6 5.6-6s2.8 6 5.6 6 2.8-6 5.6-6c1.4 0 2.1 1.5 2.8 3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      );
  }
}

export function GameGlyph({
  gameId,
  className = "size-12",
}: {
  gameId: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex flex-none items-center justify-center rounded-[var(--radius-md)] ${className}`}
      style={{
        backgroundImage: tileGradient(gameId),
        color: "var(--text-on-accent)",
        boxShadow: "var(--shadow-2), var(--edge-highlight)",
      }}
    >
      <svg viewBox="0 0 24 24" className="size-2/3" fill="currentColor" aria-hidden="true">
        <Motif motif={motifForId(gameId)} />
      </svg>
    </span>
  );
}
