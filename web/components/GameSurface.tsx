import type { ReactNode } from "react";

// The "arcade cabinet" every game's UI is mounted into: a bezel strip
// showing the game's name (and an optional status slot) above a recessed
// playfield well. Strictly presentational — it never inspects `view`,
// `players`, `result`, or any game id; everything it shows is passed in by
// the caller.
export function GameSurface({
  title,
  status,
  children,
}: {
  title: string;
  children: ReactNode;
  status?: ReactNode;
}) {
  return (
    <div className="game-surface">
      <div className="game-surface-bezel">
        <span className="game-surface-title">{title}</span>
        {status !== undefined && <span className="game-surface-status">{status}</span>}
      </div>
      <div className="game-surface-well">{children}</div>
    </div>
  );
}
