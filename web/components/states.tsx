import {
  Alert,
  Button,
  EmptyState as HeroEmptyState,
  Skeleton as HeroSkeleton,
  Spinner as HeroSpinner,
} from "@heroui/react";
import type { CSSProperties, ReactNode } from "react";

// The shared loading/empty/error vocabulary every route routes its
// interstitial states through, so a slow network or an empty bucket looks
// designed rather than like a stray "Loading…" string.

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <HeroSpinner role="status" aria-label={label} />;
}

// A single reserved-size placeholder. Callers pass `width`/`height` so the
// real content that replaces it lands at (roughly) the same box, without a
// layout jump.
export function Skeleton({
  width,
  height,
  className,
}: {
  width?: string;
  height?: string;
  className?: string;
}) {
  const style: CSSProperties = {};
  if (width !== undefined) style.width = width;
  if (height !== undefined) style.height = height;
  return <HeroSkeleton className={className} style={style} aria-hidden="true" />;
}

export function EmptyState({ glyph = "○", children }: { glyph?: string; children: ReactNode }) {
  return (
    <HeroEmptyState className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-center text-muted">
      <span className="text-2xl" aria-hidden="true">
        {glyph}
      </span>
      <p className="m-0">{children}</p>
    </HeroEmptyState>
  );
}

export interface NoticeAction {
  label: string;
  onClick: () => void;
}

// `tone` picks the visual treatment; `role` picks how assistive tech
// announces it and defaults from `tone` — but a caller can override it, e.g.
// a `danger`-styled notice for a transient, still-usable failure (like a
// dropped transport) should announce as `status` (polite), not `alert`
// (which would fire on every occurrence and, for something that recurs
// across reconnects, turn into a spam of interruptions).
export function Notice({
  tone = "info",
  role,
  children,
  action,
}: {
  tone?: "info" | "danger";
  role?: "status" | "alert";
  children: ReactNode;
  action?: NoticeAction;
}) {
  const resolvedRole = role ?? (tone === "danger" ? "alert" : "status");
  return (
    <Alert status={tone === "danger" ? "danger" : "accent"} role={resolvedRole}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>{children}</Alert.Description>
        {action && (
          <Button variant="ghost" size="sm" className="mt-2 self-start" onPress={action.onClick}>
            {action.label}
          </Button>
        )}
      </Alert.Content>
    </Alert>
  );
}
