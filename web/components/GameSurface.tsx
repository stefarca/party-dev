import { Card } from "@heroui/react";
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
    <Card className="mb-4 animate-in gap-0 overflow-hidden fade-in p-0 shadow-[var(--shadow-3),var(--edge-highlight)] duration-500 fill-mode-both">
      <Card.Header className="flex flex-row items-center justify-between gap-3 border-b border-border px-4 py-3">
        <Card.Title className="text-lg font-bold text-foreground">{title}</Card.Title>
        {status !== undefined && <span className="text-sm text-muted">{status}</span>}
      </Card.Header>
      <Card.Content className="gap-0 bg-[var(--surface-inset)] p-2 shadow-[var(--shadow-inset)] sm:p-4">
        {children}
      </Card.Content>
    </Card>
  );
}
