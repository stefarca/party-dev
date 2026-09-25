import type { ReactNode } from "react";

import { BUTTON, PLAIN, PRESSED } from "./buttons";

// A switch that changes what the next tap on the board does (notes instead
// of digits, a flag instead of a dig), with a chip saying whether it is on.
// The chip's words are hidden from assistive technology, which hears
// `aria-pressed` instead.
export function ModeToggle({
  pressed,
  disabled,
  onToggle,
  icon,
  label,
  on,
  off,
}: {
  pressed: boolean;
  disabled: boolean;
  onToggle: () => void;
  icon: ReactNode;
  label: string;
  on: string;
  off: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onToggle}
      className={`${BUTTON} ${pressed ? PRESSED : PLAIN} h-11 gap-2 rounded-[var(--radius-pill)] px-4 text-sm font-bold`}
    >
      {icon}
      {label}
      <span
        aria-hidden="true"
        className="rounded-[var(--radius-pill)] px-1.5 py-px text-[0.65rem] font-bold uppercase"
        style={
          pressed
            ? { background: "var(--accent)", color: "var(--text-on-accent)" }
            : { background: "var(--surface-3)", color: "var(--text-muted)" }
        }
      >
        {pressed ? on : off}
      </span>
    </button>
  );
}
