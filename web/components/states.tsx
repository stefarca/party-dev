import { Button, Skeleton as HeroSkeleton, Spinner as HeroSpinner } from "@heroui/react";
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
// Written out rather than interpolated: Tailwind extracts class names by
// scanning this file as text, so a template-built `rounded-[...]` would
// never make it into the generated stylesheet.
const SKELETON_RADIUS = {
  md: "rounded-[var(--radius-md)]",
  lg: "rounded-[var(--radius-lg)]",
  xl: "rounded-[var(--radius-xl)]",
  pill: "rounded-[var(--radius-pill)]",
} as const;

export function Skeleton({
  width,
  height,
  className = "",
  rounded = "md",
}: {
  width?: string;
  height?: string;
  className?: string;
  rounded?: keyof typeof SKELETON_RADIUS;
}) {
  const style: CSSProperties = {};
  if (width !== undefined) style.width = width;
  if (height !== undefined) style.height = height;
  return (
    <HeroSkeleton
      className={`${SKELETON_RADIUS[rounded]} ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
}

// A dashed, friendly "nothing here yet" panel. `glyph` is decorative; the
// sentence below it always carries the meaning on its own.
export function EmptyState({ glyph = "✦", children }: { glyph?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border-2 border-dashed border-[var(--border-subtle)] bg-surface/60 px-4 py-8 text-center text-[var(--text-muted)]">
      <span className="text-2xl opacity-70" aria-hidden="true">
        {glyph}
      </span>
      <p className="m-0 text-sm">{children}</p>
    </div>
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
  const danger = tone === "danger";
  return (
    <div
      role={resolvedRole}
      className="flex animate-in items-start gap-3 rounded-[var(--radius-lg)] border-2 p-4 duration-300 fade-in slide-in-from-top-2"
      style={{
        borderColor: danger ? "var(--danger-border)" : "var(--accent-soft)",
        background: danger ? "var(--danger-soft)" : "var(--accent-soft)",
      }}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-5 flex-none items-center justify-center rounded-full text-xs font-bold"
        style={{
          background: danger ? "var(--danger-fg)" : "var(--accent)",
          color: "var(--text-on-accent)",
        }}
      >
        {danger ? "!" : "i"}
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <p
          className="m-0 text-sm"
          style={{ color: danger ? "var(--danger-fg)" : "var(--accent-on-soft)" }}
        >
          {children}
        </p>
        {action && (
          <Button variant="ghost" size="sm" className="self-start" onPress={action.onClick}>
            {action.label}
          </Button>
        )}
      </div>
    </div>
  );
}
