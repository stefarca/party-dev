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
    <div className="theme-toggle" role="group" aria-label="Theme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className="btn btn-quiet btn-sm theme-toggle-option"
          aria-pressed={preference === option.value}
          onClick={() => setThemePreference(option.value)}
        >
          <span aria-hidden="true">{option.glyph}</span> {option.label}
        </button>
      ))}
    </div>
  );
}
