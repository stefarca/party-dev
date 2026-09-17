import { ToggleButton, ToggleButtonGroup } from "@heroui/react";

import { setThemePreference, useThemePreference } from "../theme";
import type { ThemePreference } from "../theme";

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
      size="sm"
    >
      {OPTIONS.map((option) => (
        <ToggleButton key={option.value} id={option.value} aria-label={option.label}>
          <span aria-hidden="true">{option.glyph}</span>
          <span className="hidden sm:inline">{option.label}</span>
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
