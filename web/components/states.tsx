import type { CSSProperties, ReactNode } from "react";

// The shared loading/empty/error vocabulary every route routes its
// interstitial states through, so a slow network or an empty bucket looks
// designed rather than like a stray "Loading…" string.

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="spinner" role="status" aria-label={label}>
      <span className="spinner-ring" aria-hidden="true" />
    </span>
  );
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
  return (
    <span
      className={className ? `app-skeleton ${className}` : "app-skeleton"}
      style={style}
      aria-hidden="true"
    />
  );
}

export function EmptyState({ glyph = "○", children }: { glyph?: string; children: ReactNode }) {
  return (
    <div className="empty-shelf">
      <span className="empty-shelf-glyph" aria-hidden="true">
        {glyph}
      </span>
      <p>{children}</p>
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
  return (
    <div className={tone === "danger" ? "notice notice-danger" : "notice"} role={resolvedRole}>
      <p>{children}</p>
      {action && (
        <button type="button" className="btn btn-ghost" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
