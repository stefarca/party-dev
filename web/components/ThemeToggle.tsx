import { ToggleButton, ToggleButtonGroup } from "@heroui/react";

import { setThemePreference, useThemePreference } from "../theme";
import type { ThemePreference } from "../theme";

// A three-way segmented pill. Built on react-aria's ToggleButtonGroup so
// arrow-key roving focus and the radio semantics come for free; the look is
// all local — a pill track with the selected segment lifted out of it.

const OPTIONS: { value: ThemePreference; label: string; glyph: string }[] = [
  { value: "system", label: "System", glyph: "◐" },
  { value: "light", label: "Light", glyph: "☀" },
  { value: "dark", label: "Dark", glyph: "☾" },
];

export function ThemeToggle() {
  const preference = useThemePreference();

  return (
    <ToggleButtonGroup
      aria-label="Theme"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[preference]}
      onSelectionChange={(keys) => {
        const next = [...keys][0] as ThemePreference | undefined;
        if (next) setThemePreference(next);
      }}
      className="inline-flex gap-0.5 rounded-[var(--radius-pill)] border border-[var(--border-subtle)] bg-[var(--surface-2)] p-1"
    >
      {OPTIONS.map((option) => (
        <ToggleButton
          key={option.value}
          id={option.value}
          aria-label={option.label}
          className="flex size-8 items-center justify-center rounded-[var(--radius-pill)] border-none bg-transparent text-base text-[var(--text-muted)] transition-[transform,background-color,color] duration-[var(--dur-fast)] ease-[var(--ease-spring)] hover:text-[var(--text-primary)] data-selected:scale-105 data-selected:bg-[var(--surface-1)] data-selected:text-[var(--accent-on-soft)] data-selected:shadow-[var(--shadow-1),var(--edge-highlight)]"
        >
          <span aria-hidden="true">{option.glyph}</span>
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
