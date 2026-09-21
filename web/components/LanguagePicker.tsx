import { Button, Dropdown, Label } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { setLanguage, useLanguage } from "../i18n";
import { LANGUAGES } from "../translations";

// A menu rather than a segmented pill like ThemeToggle: it stays one small button however many
// languages ship, which is what lets it sit in a row of the profile popup (and under the nickname
// gate) at phone width.
//
// Each language is named in itself ("Italiano", never "Italian"), on the button as well as in the
// list, so a player the app opened in a language they cannot read can still find theirs.
export function LanguagePicker() {
  const { t, i18n } = useTranslation();
  const language = useLanguage();
  const nameOf = (code: string) => i18n.getFixedT(code)("languageName");

  return (
    <Dropdown>
      <Button
        variant="ghost"
        aria-label={t("language.current", { language: nameOf(language) })}
        className="h-10 min-w-0 flex-none gap-1.5 rounded-[var(--radius-pill)] border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 text-sm font-bold text-[var(--text-muted)] transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] hover:scale-105 hover:text-[var(--text-primary)]"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-4 flex-none"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
        </svg>
        <span lang={language}>{nameOf(language)}</span>
      </Button>
      {/* The focus ring is drawn 6px outside an item with --radius-xs corners. The menu's padding
          leaves it room to breathe, and the popover's radius is the item's plus that padding, so
          the ring, the items and the popover are concentric. */}
      <Dropdown.Popover placement="bottom end" className="rounded-[calc(var(--radius-xs)+10px)]">
        <Dropdown.Menu
          className="p-2.5"
          aria-label={t("language.label")}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[language]}
          onSelectionChange={(keys) => {
            const next = keys === "all" ? undefined : [...keys][0];
            if (typeof next === "string" && next !== language) setLanguage(next);
          }}
        >
          {LANGUAGES.map((code) => (
            <Dropdown.Item
              key={code}
              id={code}
              textValue={nameOf(code)}
              className="rounded-[var(--radius-xs)]"
            >
              <Dropdown.ItemIndicator />
              <Label lang={code}>{nameOf(code)}</Label>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
